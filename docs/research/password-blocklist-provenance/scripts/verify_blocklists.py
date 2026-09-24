#!/usr/bin/env python3
"""
verify_blocklists.py
Analyzes candidate password blocklists, measures load performance and memory,
and executes synthetic test cases verifying NFC normalization, case/whitespace
preservation, exact-match vs substring matching, and integrity checks.

STRICT SECURITY RULE:
Under no circumstances are plaintext passwords from breach lists logged or printed.
Synthetic tests use purely synthetic, isolated test tokens.
"""

import gzip
import hashlib
import os
import sys
import time
import tracemalloc
import unicodedata

def analyze_dataset(name, file_path, is_gz=False):
    print(f"==================================================")
    print(f"Dataset Analysis: {name}")
    print(f"File Path: {file_path}")
    print(f"==================================================")
    
    file_size = os.path.getsize(file_path)
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    actual_sha256 = h.hexdigest()
    
    open_fn = gzip.open if is_gz else open
    mode = "rb"
    with open_fn(file_path, mode) as f:
        raw_lines = f.readlines()
        
    total_lines = len(raw_lines)
    crlf_count = 0
    lf_count = 0
    utf8_decode_errors = 0
    decoded_lines = []
    
    for l in raw_lines:
        if l.endswith(b"\r\n"):
            crlf_count += 1
            content = l[:-2]
        elif l.endswith(b"\n"):
            lf_count += 1
            content = l[:-1]
        elif l.endswith(b"\r"):
            crlf_count += 1
            content = l[:-1]
        else:
            content = l
            
        try:
            decoded = content.decode("utf-8")
        except UnicodeDecodeError:
            utf8_decode_errors += 1
            decoded = content.decode("utf-8", errors="replace")
        decoded_lines.append(decoded)
        
    non_empty_lines = [s for s in decoded_lines if len(s) > 0]
    empty_lines_count = total_lines - len(non_empty_lines)
    unique_lines = set(non_empty_lines)
    duplicates_count = len(non_empty_lines) - len(unique_lines)
    
    # NFC changes check
    nfc_diff_count = sum(1 for s in non_empty_lines if unicodedata.normalize("NFC", s) != s)
    
    # Lengths in Unicode code points
    lengths = [len(s) for s in non_empty_lines]
    min_len = min(lengths) if lengths else 0
    max_len = max(lengths) if lengths else 0
    avg_len = sum(lengths) / len(lengths) if lengths else 0
    
    lt_15 = sum(1 for l in lengths if l < 15)
    gte_15 = sum(1 for l in lengths if l >= 15)
    between_15_128 = sum(1 for l in lengths if 15 <= l <= 128)
    gt_128 = sum(1 for l in lengths if l > 128)
    
    # Character and case breakdown
    ascii_count = sum(1 for s in non_empty_lines if s.isascii())
    non_ascii_count = len(non_empty_lines) - ascii_count
    korean_count = sum(1 for s in non_empty_lines if any('\uac00' <= c <= '\ud7a3' for c in s))
    
    leading_trailing_ws = sum(1 for s in non_empty_lines if s != s.strip())
    internal_ws = sum(1 for s in non_empty_lines if ' ' in s.strip() or '\t' in s.strip())
    
    is_lower = sum(1 for s in non_empty_lines if s.islower())
    is_upper = sum(1 for s in non_empty_lines if s.isupper())
    is_mixed = sum(1 for s in non_empty_lines if any(c.isupper() for c in s) and any(c.islower() for c in s))
    
    print(f"File Size: {file_size} bytes")
    print(f"SHA-256: {actual_sha256}")
    print(f"Total Lines: {total_lines}, Non-empty Lines: {len(non_empty_lines)}, Empty Lines: {empty_lines_count}")
    print(f"Line Endings: LF={lf_count}, CRLF={crlf_count}, UTF-8 Decode Errors: {utf8_decode_errors}")
    print(f"Duplicates (in non-empty): {duplicates_count}")
    print(f"Lines altered by NFC normalization: {nfc_diff_count}")
    print(f"Length Distribution (Unicode code points):")
    print(f"  Min Length: {min_len}, Max Length: {max_len}, Avg Length: {avg_len:.2f}")
    print(f"  Length < 15: {lt_15} ({lt_15 / len(non_empty_lines) * 100:.2f}%)")
    print(f"  Length >= 15: {gte_15} ({gte_15 / len(non_empty_lines) * 100:.2f}%)")
    print(f"  Length 15..128: {between_15_128} ({between_15_128 / len(non_empty_lines) * 100:.2f}%)")
    print(f"  Length > 128: {gt_128}")
    print(f"Character Composition:")
    print(f"  ASCII Only: {ascii_count}, Non-ASCII: {non_ascii_count}, Korean (Hangul): {korean_count}")
    print(f"  Whitespace: Leading/Trailing={leading_trailing_ws}, Internal={internal_ws}")
    print(f"  Case: Lowercase={is_lower}, Uppercase={is_upper}, Mixed-case={is_mixed}")
    print()

def benchmark_dataset(name, file_path, is_gz=False):
    print(f"Benchmark: {name}")
    open_fn = gzip.open if is_gz else open
    mode = "rt" if is_gz else "r"
    
    # 1. Measure String Set Load
    tracemalloc.start()
    t0 = time.perf_counter()
    str_set = set()
    with open_fn(file_path, mode, encoding="utf-8", errors="replace") as f:
        for line in f:
            pw = line.rstrip("\r\n")
            if pw:
                str_set.add(unicodedata.normalize("NFC", pw))
    t1 = time.perf_counter()
    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    str_load_time_ms = (t1 - t0) * 1000
    str_peak_mb = peak / (1024 * 1024)
    
    # 2. Measure SHA-256 Binary Digest Set Load
    tracemalloc.start()
    t0 = time.perf_counter()
    sha_set = set()
    with open_fn(file_path, mode, encoding="utf-8", errors="replace") as f:
        for line in f:
            pw = line.rstrip("\r\n")
            if pw:
                norm = unicodedata.normalize("NFC", pw)
                sha_set.add(hashlib.sha256(norm.encode("utf-8")).digest())
    t1 = time.perf_counter()
    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    sha_load_time_ms = (t1 - t0) * 1000
    sha_peak_mb = peak / (1024 * 1024)
    
    # 3. Lookup Latency using synthetic test tokens
    synthetic_queries = [
        "SYNTHETIC_BENCHMARK_TOKEN_A_12345",
        "SYNTHETIC_BENCHMARK_TOKEN_B_67890",
        "SYNTHETIC_BENCHMARK_TOKEN_C_ABCDE",
        "SYNTHETIC_BENCHMARK_TOKEN_D_FGHIJ"
    ]
    iterations = 50000
    t_start = time.perf_counter()
    for _ in range(iterations):
        for q in synthetic_queries:
            _ = unicodedata.normalize("NFC", q) in str_set
    t_end = time.perf_counter()
    total_lookups = iterations * len(synthetic_queries)
    latency_us = ((t_end - t_start) / total_lookups) * 1_000_000
    
    print(f"  String Set:  Count={len(str_set)}, Load Time={str_load_time_ms:.2f} ms, Peak RAM={str_peak_mb:.2f} MB")
    print(f"  SHA-256 Set: Count={len(sha_set)}, Load Time={sha_load_time_ms:.2f} ms, Peak RAM={sha_peak_mb:.2f} MB")
    print(f"  Lookup Latency: {latency_us:.3f} microseconds/query ({total_lookups / (t_end - t_start):,.0f} queries/sec)")
    print()
    return str_set

def run_synthetic_tests(ncsc_set, target_dir):
    print("==================================================")
    print("Synthetic Policy and Integrity Verification Tests")
    print("==================================================")
    
    # -------------------------------------------------------------
    # (a) Synthetic Logic Tests (completely independent test tokens)
    # -------------------------------------------------------------
    syn_pw = "SYNTHETIC_BLOCKLIST_TOKEN_FOR_POLICY_TEST_12345"
    syn_blocklist = {unicodedata.normalize("NFC", syn_pw)}
    
    # TEST 1: Exact match on synthetic token
    norm_pw = unicodedata.normalize("NFC", syn_pw)
    is_blocked = norm_pw in syn_blocklist
    print(f"[TEST 1] Exact match on synthetic token (len={len(syn_pw)}):")
    print(f"         Result: {'BLOCKED (Expected)' if is_blocked else 'ALLOWED (Unexpected)'}")
    assert is_blocked, "Test 1 failed: synthetic token was not blocked"
    
    # TEST 2: Whole-string matching vs substring matching
    syn_substring = f"PREFIX_{syn_pw}_SUFFIX"
    norm_sub = unicodedata.normalize("NFC", syn_substring)
    is_sub_blocked = norm_sub in syn_blocklist
    print(f"[TEST 2] Whole-string match check on substring containing synthetic token:")
    print(f"         Result: {'ALLOWED (Expected, substring not blocked)' if not is_sub_blocked else 'BLOCKED (Unexpected)'}")
    assert not is_sub_blocked, "Test 2 failed: substring was falsely blocked"
    
    # TEST 3: Case preservation assertion on synthetic set
    syn_cased = "SyntheticCaseSensitiveToken15Chars"
    syn_case_blocklist = {syn_cased}
    syn_lower = syn_cased.lower()
    
    in_syn_cased = syn_cased in syn_case_blocklist
    in_syn_lower = syn_lower in syn_case_blocklist
    print(f"[TEST 3] Case preservation test on synthetic set:")
    print(f"         Cased token in blocklist: {in_syn_cased} (Expected: True)")
    print(f"         Lower token in blocklist: {in_syn_lower} (Expected: False)")
    assert in_syn_cased is True, "Test 3 failed: exact case did not match"
    assert in_syn_lower is False, "Test 3 failed: lowercased variant matched when casefold was not enabled"
    print(f"         Result: Case is preserved; exact case matches and lowercase variant does not match (PASS).")
    
    # TEST 4: Whitespace preservation (No trim)
    syn_spaces = f" {syn_pw} "
    norm_spaces = unicodedata.normalize("NFC", syn_spaces)
    is_spaces_blocked = norm_spaces in syn_blocklist
    print(f"[TEST 4] Whitespace preservation on synthetic token:")
    print(f"         Result: {'ALLOWED (Expected, no trim applied)' if not is_spaces_blocked else 'BLOCKED (Unexpected)'}")
    assert not is_spaces_blocked, "Test 4 failed: whitespace was trimmed"
    
    # TEST 5: Unicode NFC normalization equivalence (Synthetic Logic Verification)
    composed_hangul_sample = "합성유니코드검증토큰15글자"
    decomposed_hangul_sample = unicodedata.normalize("NFD", composed_hangul_sample)
    assert composed_hangul_sample != decomposed_hangul_sample, "Hangul did not decompose!"
    
    synthetic_hangul_blocklist = {unicodedata.normalize("NFC", composed_hangul_sample)}
    input_normalized = unicodedata.normalize("NFC", decomposed_hangul_sample)
    assert input_normalized in synthetic_hangul_blocklist, "NFC normalization equivalence failed"
    assert decomposed_hangul_sample not in synthetic_hangul_blocklist, "Decomposed string matched raw without NFC"
    print(f"[TEST 5] Synthetic logic verification (Unicode NFC equivalence):")
    print(f"         Composed (NFC) vs Decomposed (NFD) string equivalence verified.")
    print(f"         Normalized query matches stored NFC entry (PASS).")
    
    # TEST 6: Hash integrity check and corrupted file detection
    ncsc_file = os.path.join(target_dir, "100k-most-used-passwords-NCSC.txt")
    valid_sha = "c2e5696882c603b76bb67a47ee970897e5a76fc4c3f5547abe3d0ca340c576e0"
    
    def verify_file_hash(path, expected_hash):
        if not os.path.exists(path):
            raise FileNotFoundError(f"Missing blocklist file: {path}")
        h = hashlib.sha256()
        with open(path, "rb") as f:
            while chunk := f.read(65536):
                h.update(chunk)
        actual = h.hexdigest()
        if actual != expected_hash:
            raise ValueError(f"Hash mismatch: expected {expected_hash}, got {actual}")
        return True

    # 6A: Valid hash
    assert verify_file_hash(ncsc_file, valid_sha) is True
    print(f"[TEST 6A] Valid hash verification: PASS")
    
    # 6B: Corrupted hash detection
    corrupted_caught = False
    try:
        verify_file_hash(ncsc_file, "0000000000000000000000000000000000000000000000000000000000000000")
    except ValueError:
        corrupted_caught = True
        print(f"[TEST 6B] Corrupted hash detection: PASS (Caught expected ValueError)")
    assert corrupted_caught, "Test 6B failed: corrupted hash was not caught"
    
    # 6C: Missing file detection
    missing_caught = False
    try:
        verify_file_hash(os.path.join(target_dir, "non_existent.txt"), valid_sha)
    except FileNotFoundError:
        missing_caught = True
        print(f"[TEST 6C] Missing file detection: PASS (Caught expected FileNotFoundError)")
    assert missing_caught, "Test 6C failed: missing file was not caught"
    
    # -------------------------------------------------------------
    # (b) Real List Target Verification (without logging plaintexts)
    # -------------------------------------------------------------
    # Verify that an entry at line 100 in NCSC list can be looked up
    # Record only line number, entry length, and SHA-256 digest
    with open(ncsc_file, "r", encoding="utf-8") as f:
        for idx, line in enumerate(f, 1):
            if idx == 100:
                raw_item = line.rstrip("\r\n")
                item_len = len(raw_item)
                item_sha256 = hashlib.sha256(raw_item.encode("utf-8")).hexdigest()
                assert raw_item in ncsc_set, "Record at line 100 missing from set"
                print(f"[TEST 7] Real dataset lookup by index without plaintext leakage:")
                print(f"         Line: 100, Length: {item_len}, SHA-256: {item_sha256}")
                print(f"         Presence in in-memory set: Verified (PASS)")
                break

    print("\nAll synthetic and integrity tests passed successfully.")

def main():
    target_dir = sys.argv[1] if len(sys.argv) > 1 else "/tmp/pw-research-download"
    print(f"Executing blocklist verification against target directory: {target_dir}")
    
    candidates = [
        ("SecLists NCSC 100k", os.path.join(target_dir, "100k-most-used-passwords-NCSC.txt"), False),
        ("Django 20k common (compressed)", os.path.join(target_dir, "common-passwords.txt.gz"), True),
        ("Django 20k common (decompressed)", os.path.join(target_dir, "common-passwords.txt"), False),
        ("SecLists 10k-most-common", os.path.join(target_dir, "10k-most-common.txt"), False),
        ("SecLists probable-v2-1575", os.path.join(target_dir, "probable-v2_top-1575.txt"), False),
        ("SecLists xato-net-10k", os.path.join(target_dir, "xato-net-10-million-passwords-10000.txt"), False),
    ]
    
    for name, path, is_gz in candidates:
        if os.path.exists(path):
            analyze_dataset(name, path, is_gz)
        else:
            print(f"Warning: candidate file not found: {path}")
        
    print("==================================================")
    print("Benchmark Load and Memory Footprint")
    print("==================================================")
    ncsc_set = None
    # Benchmark primary datasets
    benchmark_candidates = [
        ("SecLists NCSC 100k", os.path.join(target_dir, "100k-most-used-passwords-NCSC.txt"), False),
        ("Django 20k common (compressed)", os.path.join(target_dir, "common-passwords.txt.gz"), True),
        ("SecLists 10k-most-common", os.path.join(target_dir, "10k-most-common.txt"), False),
        ("SecLists probable-v2-1575", os.path.join(target_dir, "probable-v2_top-1575.txt"), False),
        ("SecLists xato-net-10k", os.path.join(target_dir, "xato-net-10-million-passwords-10000.txt"), False),
    ]
    for name, path, is_gz in benchmark_candidates:
        s = benchmark_dataset(name, path, is_gz)
        if "NCSC" in name:
            ncsc_set = s
            
    run_synthetic_tests(ncsc_set, target_dir)

if __name__ == "__main__":
    main()
