#!/usr/bin/env bash
set -e

cd ../backend
source .venv/bin/activate
uvicorn app.main:app --reload
