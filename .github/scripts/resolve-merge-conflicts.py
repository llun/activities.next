#!/usr/bin/env python3
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

MODELS = [
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-2.5-flash",
]

MAX_RETRIES = 4
BASE_RETRY_DELAY = 2.0


def call_gemini(prompt: str, system_instruction: str = "", api_key: str = "") -> str:
    """Call Google Gemini generateContent API with fallback across model versions and retries."""
    if not api_key:
        api_key = os.environ.get("GEMINI_API_KEY", "").strip()

    if not api_key:
        raise ValueError("GEMINI_API_KEY is not set or is empty.")

    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt}],
            }
        ],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 8192,
        },
    }

    if system_instruction:
        payload["systemInstruction"] = {
            "parts": [{"text": system_instruction}]
        }

    last_error = None
    for model in MODELS:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
        headers = {"Content-Type": "application/json"}
        data = json.dumps(payload).encode("utf-8")

        for attempt in range(MAX_RETRIES):
            req = urllib.request.Request(url, data=data, headers=headers, method="POST")
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    resp_data = json.loads(resp.read().decode("utf-8"))

                candidates = resp_data.get("candidates", [])
                if not candidates:
                    raise RuntimeError(f"No candidates returned by Gemini ({model}): {resp_data}")

                parts = candidates[0].get("content", {}).get("parts", [])
                # Filter out thinking/reasoning parts
                text_parts = [
                    p.get("text", "")
                    for p in parts
                    if not p.get("thought", False) and "text" in p
                ]
                output = "".join(text_parts).strip()
                if not output and parts:
                    # Fallback if thought filtering was overly strict
                    output = "".join(p.get("text", "") for p in parts if "text" in p).strip()

                return output

            except urllib.error.HTTPError as e:
                status = e.code
                err_body = ""
                try:
                    err_body = e.read().decode("utf-8")
                except Exception:
                    pass

                last_error = f"HTTP {status} from {model}: {err_body}"
                # Rate limit (429) or server errors (5xx): retry with exponential backoff
                if status in (429, 500, 502, 503, 504) and attempt < MAX_RETRIES - 1:
                    sleep_time = BASE_RETRY_DELAY * (2 ** attempt)
                    print(f"Warning: {model} returned {status}. Retrying in {sleep_time:.1f}s...", file=sys.stderr)
                    time.sleep(sleep_time)
                    continue
                else:
                    # Non-retryable or retries exhausted for this model, try next model
                    print(f"Warning: {model} failed with {status}. Trying next model...", file=sys.stderr)
                    break

            except urllib.error.URLError as e:
                last_error = f"URLError for {model}: {e.reason}"
                if attempt < MAX_RETRIES - 1:
                    sleep_time = BASE_RETRY_DELAY * (2 ** attempt)
                    print(f"Warning: Network error for {model}: {e.reason}. Retrying in {sleep_time:.1f}s...", file=sys.stderr)
                    time.sleep(sleep_time)
                    continue
                else:
                    break

            except Exception as e:
                last_error = f"Unexpected error with {model}: {e}"
                break

    raise RuntimeError(f"All Gemini models failed. Last error: {last_error}")


def strip_markdown_fences(text: str) -> str:
    """Strip markdown code fence wrapper if the model returned code enclosed in ```."""
    lines = text.splitlines()
    if len(lines) >= 2 and lines[0].startswith("```") and lines[-1].startswith("```"):
        return "\n".join(lines[1:-1])
    return text


class ConflictHunk:
    def __init__(self, start_idx: int, end_idx: int, our_lines: list[str], their_lines: list[str]):
        self.start_idx = start_idx  # line index of <<<<<<<
        self.end_idx = end_idx      # line index of >>>>>>>
        self.our_lines = our_lines
        self.their_lines = their_lines


def find_conflict_hunks(lines: list[str]) -> list[ConflictHunk]:
    """Parse git conflict markers line by line."""
    hunks = []
    state = "NORMAL"
    start_idx = -1
    our_lines = []
    their_lines = []

    for i, line in enumerate(lines):
        if line.startswith("<<<<<<<"):
            state = "OURS"
            start_idx = i
            our_lines = []
            their_lines = []
        elif line.startswith("|||||||") and state == "OURS":
            state = "BASE"
        elif line.startswith("=======") and state in ("OURS", "BASE"):
            state = "THEIRS"
        elif line.startswith(">>>>>>>") and state == "THEIRS":
            hunks.append(ConflictHunk(start_idx, i, our_lines, their_lines))
            state = "NORMAL"
        else:
            if state == "OURS":
                our_lines.append(line)
            elif state == "THEIRS":
                their_lines.append(line)

    return hunks


def resolve_hunk(
    filepath: str,
    hunk: ConflictHunk,
    all_lines: list[str],
    main_sha: str
) -> str:
    """Resolve a single conflict hunk using Gemini with surrounding context."""
    context_before = "".join(all_lines[max(0, hunk.start_idx - 25) : hunk.start_idx])
    context_after = "".join(all_lines[hunk.end_idx + 1 : min(len(all_lines), hunk.end_idx + 26)])
    our_code = "".join(hunk.our_lines)
    their_code = "".join(hunk.their_lines)

    system_instruction = (
        "You are an automated Git merge conflict resolver for the repository activities.next.\n"
        "You are merging commit from 'main' into 'oltp' (HEAD).\n"
        "Guidelines:\n"
        "- Follow repository conventions from AGENTS.md.\n"
        "- Retain valid syntax, correct imports, and proper typing.\n"
        "- Combine conflicting additions or changes logically so both features/fixes work.\n"
        "- If both modified a dependency or version, take the newer version or main's update unless oltp added a specific feature.\n"
        "- Return ONLY the replacement code lines that will replace the entire conflict block (between <<<<<<< and >>>>>>>).\n"
        "- Do NOT output <<<<<<<, =======, or >>>>>>> markers.\n"
        "- Do NOT output the surrounding context lines.\n"
        "- Do NOT include explanations or conversational filler.\n"
        "- Do NOT wrap in markdown ``` fences unless the code itself contains them."
    )

    prompt = f"""File: {filepath}
Merging: 'main' commit ({main_sha}) into branch 'oltp' (HEAD).

--- Surrounding Context Before ---
{context_before}

--- Conflict Block ---
<<<<<<< HEAD (oltp)
{our_code}======= (main)
{their_code}>>>>>>> main

--- Surrounding Context After ---
{context_after}

Provide ONLY the exact replacement code for the Conflict Block:"""

    raw_response = call_gemini(prompt, system_instruction=system_instruction)
    cleaned = strip_markdown_fences(raw_response)

    # If the response doesn't end with a newline and was non-empty, ensure a newline
    if cleaned and not cleaned.endswith("\n"):
        cleaned += "\n"

    return cleaned


def resolve_package_json(filepath: str, content: str, main_sha: str) -> str:
    """Resolve package.json specifically, validating that resulting content is valid JSON."""
    lines = content.splitlines(keepends=True)
    hunks = find_conflict_hunks(lines)
    if not hunks:
        return content

    print(f"Resolving {len(hunks)} conflict block(s) in {filepath}...", file=sys.stderr)

    # Replace hunks from bottom to top so line indices remain stable
    for hunk in reversed(hunks):
        resolved_chunk = resolve_hunk(filepath, hunk, lines, main_sha)
        lines[hunk.start_idx : hunk.end_idx + 1] = [resolved_chunk]

    resolved_content = "".join(lines)

    # Validate JSON syntax
    try:
        json.loads(resolved_content)
        return resolved_content
    except json.JSONDecodeError as e:
        print(f"Warning: JSON validation failed on block replacement ({e}). Asking Gemini for full JSON reconciliation...", file=sys.stderr)

    # If hunk replacement resulted in JSON syntax errors (e.g. comma placement),
    # ask Gemini to reconcile the full package.json cleanly
    prompt = f"""The following package.json contains merge conflict markers or syntax errors resulting from merging 'main' ({main_sha}) into 'oltp' (HEAD).

Resolve all conflicts and syntax errors.
Rules:
1. Return valid JSON only.
2. Ensure both sets of dependencies and scripts are properly preserved without duplicates.
3. Completely remove all conflict markers (<<<<<<<, =======, >>>>>>>).
4. No markdown formatting, no explanations, only the raw JSON text.

Content:
{content}
"""
    system_instruction = "You are a JSON formatter and merge resolver. Return ONLY valid JSON with no markdown and no explanation."
    full_resolved = call_gemini(prompt, system_instruction=system_instruction)
    full_resolved = strip_markdown_fences(full_resolved)

    try:
        # Validate and re-format cleanly with 2-space indentation
        parsed = json.loads(full_resolved)
        return json.dumps(parsed, indent=2) + "\n"
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Failed to produce valid JSON for package.json: {e}\nRaw output:\n{full_resolved}")


def resolve_file(filepath: str, main_sha: str) -> None:
    """Resolve merge conflict markers in a single file."""
    if not os.path.isfile(filepath):
        print(f"Skipping {filepath}: not a regular file", file=sys.stderr)
        return

    with open(filepath, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()

    if not re.search(r"^(<{7}|={7}|>{7})", content, re.MULTILINE):
        print(f"No conflict markers found in {filepath}.", file=sys.stderr)
        return

    print(f"Resolving conflicts in {filepath}...", file=sys.stderr)

    if os.path.basename(filepath) == "package.json":
        resolved_content = resolve_package_json(filepath, content, main_sha)
    else:
        lines = content.splitlines(keepends=True)
        hunks = find_conflict_hunks(lines)
        if not hunks:
            print(f"No parseable conflict hunks in {filepath}.", file=sys.stderr)
            return

        print(f"Found {len(hunks)} conflict hunk(s) in {filepath}.", file=sys.stderr)
        # Replace from bottom to top
        for hunk in reversed(hunks):
            resolved_chunk = resolve_hunk(filepath, hunk, lines, main_sha)
            lines[hunk.start_idx : hunk.end_idx + 1] = [resolved_chunk]

        resolved_content = "".join(lines)

    # Double check for leftover conflict markers
    leftover = re.findall(r"^(<{7}[^\n]*|={7}|>{7}[^\n]*)", resolved_content, re.MULTILINE)
    if leftover:
        raise RuntimeError(
            f"Conflict markers still remain in {filepath} after Gemini resolution:\n"
            + "\n".join(leftover[:10])
        )

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(resolved_content)

    print(f"Successfully resolved and updated {filepath}.", file=sys.stderr)


def main():
    if len(sys.argv) < 2:
        print("Usage: resolve-merge-conflicts.py <file1> [<file2> ...]", file=sys.stderr)
        sys.exit(1)

    files = sys.argv[1:]
    main_sha = os.environ.get("MAIN_SHA", "main").strip() or "main"

    print(f"Starting Gemini conflict resolution for {len(files)} file(s). Target commit: {main_sha}", file=sys.stderr)

    failed_files = []
    for f in files:
        try:
            resolve_file(f, main_sha)
        except Exception as e:
            print(f"::error::Failed resolving {f}: {e}", file=sys.stderr)
            failed_files.append((f, str(e)))

    if failed_files:
        print(f"Failed to resolve {len(failed_files)} file(s):", file=sys.stderr)
        for f, err in failed_files:
            print(f"  - {f}: {err}", file=sys.stderr)
        sys.exit(1)

    print("All conflicted files resolved successfully.", file=sys.stderr)


if __name__ == "__main__":
    main()
