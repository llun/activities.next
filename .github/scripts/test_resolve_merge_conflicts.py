#!/usr/bin/env python3
import importlib.util
import json
import os
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "resolver",
    os.path.join(os.path.dirname(__file__), "resolve-merge-conflicts.py"),
)
resolver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resolver)


class TestResolveMergeConflicts(unittest.TestCase):
    def test_strip_markdown_fences(self):
        self.assertEqual(
            resolver.strip_markdown_fences("```json\n{\"a\": 1}\n```"),
            "{\"a\": 1}",
        )
        self.assertEqual(
            resolver.strip_markdown_fences("const x = 10;"),
            "const x = 10;",
        )

    def test_find_conflict_hunks_standard(self):
        sample = """line 1
<<<<<<< HEAD
our code
=======
their code
>>>>>>> main
line 2
"""
        lines = sample.splitlines(keepends=True)
        hunks = resolver.find_conflict_hunks(lines)
        self.assertEqual(len(hunks), 1)
        self.assertEqual(hunks[0].start_idx, 1)
        self.assertEqual(hunks[0].end_idx, 5)
        self.assertEqual(hunks[0].our_lines, ["our code\n"])
        self.assertEqual(hunks[0].their_lines, ["their code\n"])

    def test_find_conflict_hunks_diff3(self):
        sample = """line 1
<<<<<<< HEAD
our code
||||||| base
base code
=======
their code
>>>>>>> main
line 2
"""
        lines = sample.splitlines(keepends=True)
        hunks = resolver.find_conflict_hunks(lines)
        self.assertEqual(len(hunks), 1)
        self.assertEqual(hunks[0].our_lines, ["our code\n"])
        self.assertEqual(hunks[0].their_lines, ["their code\n"])

    def test_resolve_package_json(self):
        conflicted = """{
  "name": "activities.next",
  "dependencies": {
<<<<<<< HEAD
    "google-auth-library": "^11.0.2",
    "got": "^15.1.0",
=======
    "got": "^16.0.0",
>>>>>>> main
    "next": "^16.3.3"
  }
}
"""
        with tempfile.TemporaryDirectory() as temp_dir:
            path = os.path.join(temp_dir, "package.json")
            with open(path, "w") as f:
                f.write(conflicted)

            with patch.object(
                resolver,
                "call_gemini",
                return_value='    "google-auth-library": "^11.0.2",\n    "got": "^16.0.0",\n',
            ):
                resolver.resolve_file(path, "test_sha")

            with open(path) as f:
                data = json.load(f)

            self.assertEqual(data["dependencies"]["google-auth-library"], "^11.0.2")
            self.assertEqual(data["dependencies"]["got"], "^16.0.0")
            self.assertEqual(data["dependencies"]["next"], "^16.3.3")

    def test_resolve_code_file(self):
        conflicted = """import { describe, it } from 'vitest'

describe('test', () => {
<<<<<<< HEAD
  const a = 1
=======
  const a = 2
>>>>>>> main
})
"""
        with tempfile.TemporaryDirectory() as temp_dir:
            path = os.path.join(temp_dir, "test.ts")
            with open(path, "w") as f:
                f.write(conflicted)

            with patch.object(
                resolver,
                "call_gemini",
                return_value="  const a = 2\n",
            ):
                resolver.resolve_file(path, "test_sha")

            with open(path) as f:
                content = f.read()

            self.assertIn("const a = 2", content)
            self.assertNotIn("<<<<<<<", content)
            self.assertNotIn("=======", content)
            self.assertNotIn(">>>>>>>", content)


if __name__ == "__main__":
    unittest.main()
