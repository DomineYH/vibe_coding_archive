#!/usr/bin/env python3
"""
convert_blocklist.py
Converts a raw password list into a canonical NFC-normalized format or
a precomputed SHA-256 binary hash lookup file.
Strictly executed in isolated temporary directories (/tmp/...).
Outputs statistics, entry counts, and SHA-256 hashes of the converted artifacts.
"""

import argparse
import gzip
import hashlib
import os
import sys
import unicodedata

def convert(input_path, output_path, format_type="text", min_len=0, max_len=128):
    if not os.path.exists(input_path):
        print(f"Error: input file not found: {input_path}", file=sys.stderr)
        return 1

    is_input_gz = input_path.endswith(".gz")
    open_in = gzip.open if is_input_gz else open
    mode_in = "rt" if is_input_gz else "r"

    total_read = 0
    empty_lines = 0
    filtered_out_len = 0
    unique_entries = set()
    unique_hashes = set()

    print(f"Converting '{input_path}' -> '{output_path}' (format={format_type}, length={min_len}..{max_len})...")
    with open_in(input_path, mode_in, encoding="utf-8", errors="replace") as fin:
        for line in fin:
            total_read += 1
            pw = line.rstrip("\r\n")
            if not pw:
                empty_lines += 1
            else:
                norm = unicodedata.normalize("NFC", pw)
                code_points = len(norm)
                if code_points < min_len or code_points > max_len:
                    filtered_out_len += 1
                else:
                    unique_entries.add(norm)
                    if format_type == "binary_sha256":
                        digest = hashlib.sha256(norm.encode("utf-8")).digest()
                        unique_hashes.add(digest)

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    if format_type == "binary_sha256":
        # Write sorted 32-byte binary digests
        sorted_digests = sorted(unique_hashes)
        with open(output_path, "wb") as fout:
            for d in sorted_digests:
                fout.write(d)
        final_count = len(sorted_digests)
    elif format_type == "text_gz":
        sorted_entries = sorted(unique_entries)
        with gzip.open(output_path, "wt", encoding="utf-8") as fout:
            for entry in sorted_entries:
                fout.write(f"{entry}\n")
        final_count = len(sorted_entries)
    else:  # text
        sorted_entries = sorted(unique_entries)
        with open(output_path, "w", encoding="utf-8") as fout:
            for entry in sorted_entries:
                fout.write(f"{entry}\n")
        final_count = len(sorted_entries)

    output_size = os.path.getsize(output_path)
    h = hashlib.sha256()
    with open(output_path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    output_sha256 = h.hexdigest()

    print(f"Conversion Summary:")
    print(f"  Total Lines Read: {total_read}")
    print(f"  Empty Lines Skipped: {empty_lines}")
    print(f"  Filtered by Length ({min_len}..{max_len}): {filtered_out_len}")
    print(f"  Final Unique Records: {final_count}")
    print(f"  Output File Size: {output_size} bytes")
    print(f"  Output SHA-256: {output_sha256}")
    return 0

def main():
    parser = argparse.ArgumentParser(description="Convert password blocklist to canonical format")
    parser.add_argument("input", help="Path to raw password blocklist")
    parser.add_argument("output", help="Path for converted output file")
    parser.add_argument("--format", choices=["text", "text_gz", "binary_sha256"], default="text", help="Output format")
    parser.add_argument("--min-len", type=int, default=0, help="Minimum code points (default 0)")
    parser.add_argument("--max-len", type=int, default=128, help="Maximum code points (default 128)")
    args = parser.parse_args()

    return convert(args.input, args.output, args.format, args.min_len, args.max_len)

if __name__ == "__main__":
    sys.exit(main())
