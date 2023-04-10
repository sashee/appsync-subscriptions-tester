#!/bin/bash

APIREGION=$(terraform output -raw APIRegion) APIURL=$(terraform output -raw APIURL) node tester/index.js
