#!/bin/bash

rm -f physcraft-webserver.tar
docker build -t physcraft-webserver .
docker save -o physcraft_webserver.tar physcraft-webserver