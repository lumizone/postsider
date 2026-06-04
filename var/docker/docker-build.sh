#!/bin/bash

set -o xtrace

docker rmi localhost/postsider || true
docker build --target dist -t localhost/postsider -f Dockerfile.dev .
docker build --target devcontainer -t localhost/postsider-devcontainer -f Dockerfile.dev .
