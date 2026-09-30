# Superseded font-blocked captures

The seed API/TTY/keyboard scenario passed, but the temporary external dependency link caused Vite to reject Pretendard WOFF2 URLs outside its unchanged serving allow-list. The original run generated 10 screenshots; only the representative gallery 360×844 frame and [results](results.json) remain attached. None of those initial frames satisfies the fixed-font condition. The other nine are recorded in the [manifest](../../capture-inventory.json) as **“로컬에서 생성·확인했으나 커밋하지 않음”**.

See the [original mock re-verification log](../../logs/frontend-mock-reverify.log) for the same environment’s font 403 diagnostics. [Final seed results and two representative captures](../seed-mode/) were reverified with identical fonts inside the existing frontend allow-list and the runner’s actual loaded-font assertion. No baseline or tolerance changed; evidence retention did not rerun tests.
