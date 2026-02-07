#!/bin/bash
export FIRESTORE_EMULATOR_HOST="localhost:8080"
export TEST_DATABASE_TYPE="firestore"

# Start the emulator in the background
firebase emulators:start --only firestore &
EMULATOR_PID=$!

# Wait for the emulator to be ready
until curl -s http://localhost:8080 > /dev/null; do
  echo "Waiting for Firestore emulator..."
  sleep 1
done

# Run tests
yarn jest lib/database/firestore

# Kill the emulator
kill $EMULATOR_PID
