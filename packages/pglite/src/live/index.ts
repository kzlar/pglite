import type {
  Extension,
  ExtensionSetup,
  PGliteInterface,
  Results,
} from "../interface";

let liveQueryCounter = 0;

interface liveNamespace {
  /**
   * Create a live query
   * @param query - The query to run
   * @param params - The parameters to pass to the query
   * @param callback - A callback to run when the query is updated
   * @returns A promise that resolves to initial results
   */
  query<T>(
    query: string,
    params?: any[],
    callback?: (results: Results<T>) => void
  ): Promise<queryReturn<T>>;
}

interface queryReturn<T> {
  initialResults: Results<T>;
  unsubscribe: () => Promise<void>;
  refresh: () => Promise<void>;
}

const setup: ExtensionSetup = async (
  pg: PGliteInterface,
  emscriptenOpts: any
) => {
  const namespaceObj: liveNamespace = {
    async query<T>(
      query: string,
      params: any[] | undefined | null,
      callback: (results: Results<T>) => void
    ) {
      const id = liveQueryCounter++;

      let results: Results<T>;
      let tables: { table_name: string; schema_name: string; }[];

      await pg.transaction(async (tx) => {
        // Create a temporary view with the query
        await tx.query(
          `CREATE OR REPLACE TEMP VIEW live_query_${id}_view AS ${query}`,
          params ?? []
        );

        // Inspect which tables are used in the query
        tables = (
          await tx.query<{
            table_name: string;
            schema_name: string;
          }>(
            `
          SELECT DISTINCT
            cl.relname AS table_name,
            n.nspname AS schema_name
          FROM pg_rewrite r
          JOIN pg_depend d ON r.oid = d.objid
          JOIN pg_class cl ON d.refobjid = cl.oid
          JOIN pg_namespace n ON cl.relnamespace = n.oid
          WHERE
              r.ev_class = (
                  SELECT oid FROM pg_class WHERE relname = $1 AND relkind = 'v'
              )
              AND d.deptype = 'n';
        `,
            [`live_query_${id}_view`]
          )
        ).rows.filter((row) => row.table_name !== `live_query_${id}_view`);

        // Setup notification triggers for the tables
        const triggers = tables.map((table) => {
          return `
            CREATE OR REPLACE FUNCTION _notify_${table.schema_name}_${table.table_name}() RETURNS TRIGGER AS $$
            BEGIN
              PERFORM pg_notify('table_change__${table.schema_name}__${table.table_name}', '');
              RETURN NULL;
            END;
            $$ LANGUAGE plpgsql;
            CREATE OR REPLACE TRIGGER _notify_trigger_${table.schema_name}_${table.table_name}
            AFTER INSERT OR UPDATE OR DELETE ON ${table.schema_name}.${table.table_name}
            FOR EACH STATEMENT EXECUTE FUNCTION _notify_${table.schema_name}_${table.table_name}();
          `;
        }).join("\n");
        tx.exec(triggers);

        // Channel names to listen to
        const channels = tables.map(
          (table) => `table_change__${table.schema_name}__${table.table_name}`
        );

        // Get the initial results
        results = await tx.query<T>(`SELECT * FROM live_query_${id}_view`);
      });

      // Function to refresh the query
      const refresh = async () => {
        results = await pg.query<T>(
          `SELECT * FROM live_query_${id}_view`
        );
        callback(results);
      };

      // Setup the listeners
      const unsubList: Array<() => Promise<void>> = [];
      for (const table of tables!) {
        const unsub = await pg.listen(
          `table_change__${table.schema_name}__${table.table_name}`,
          async () => {
            refresh();
          }
        );
        unsubList.push(unsub);
      }

      // Function to unsubscribe from the query
      const unsubscribe = async () => {
        for (const unsub of unsubList) {
          await unsub();
        }
        await pg.exec(`DROP VIEW IF EXISTS live_query_${id}_view`);
      };

      // Run the callback with the initial results
      callback(results!);

      // Return the initial results
      return {
        initialResults: results!,
        unsubscribe,
        refresh,
      }
    },
  };

  return {
    // init: async () => {},
    // close: async () => {},
    namespaceObj,
  };
};

export const live = {
  name: "Live Queries",
  setup,
} satisfies Extension;
