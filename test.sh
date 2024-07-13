#!/bin/bash
export PGVERSION=16.3
export SDK_VERSION=3.1.63.0bi
export SDK_ARCHIVE=python3.12-wasm-sdk-Ubuntu-22.04.tar.lz4
export SDKROOT=/opt/python-wasm-sdk
export SYS_PYTHON=/usr/bin/python3
export PGROOT=/tmp/pglite
export DEBUG=false

sudo mkdir /opt/python-wasm-sdk
sudo chmod 777 /opt/python-wasm-sdk/

sudo apt-get install -y lz4 wget pv bash
echo https://github.com/pygame-web/python-wasm-sdk/releases/download/$SDK_VERSION/$SDK_ARCHIVE
curl -sL --retry 5 https://github.com/pygame-web/python-wasm-sdk/releases/download/$SDK_VERSION/$SDK_ARCHIVE | tar xvP --use-compress-program=lz4 | pv -p -l -s 24400 >/dev/null

bash ./cibuild.sh
bash ./cibuild.sh pg_stat_statements
bash ./cibuild.sh pg_trgm
