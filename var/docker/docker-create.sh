#!/usr/bin/env bash

docker kill postsider || true 
docker rm postsider || true 
docker create --name postsider -p 3000:3000 -p 4200:4200 localhost/postsider
