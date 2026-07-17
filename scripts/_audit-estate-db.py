#!/usr/bin/env python3
import os
import sqlite3
import json

db = "/home/xx/projects/sahiix-estate/estate.db"
print("exists", os.path.exists(db), "size", os.path.getsize(db) if os.path.exists(db) else 0)
con = sqlite3.connect(db)
cur = con.cursor()
tables = [t[0] for t in cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
print("tables", tables)
for t in tables:
    try:
        n = cur.execute(f"SELECT COUNT(*) FROM [{t}]").fetchone()[0]
        print(f"  {t}: {n}")
    except Exception as e:
        print(f"  {t}: err {e}")

for t in tables:
    try:
        cols = [d[1] for d in cur.execute(f"PRAGMA table_info([{t}])").fetchall()]
        n = cur.execute(f"SELECT COUNT(*) FROM [{t}]").fetchone()[0]
        if n == 0:
            continue
        print(f"\n=== {t} ({n}) cols={cols} ===")
        rows = cur.execute(f"SELECT * FROM [{t}] LIMIT 10").fetchall()
        for r in rows:
            print(r)
    except Exception as e:
        print(t, e)
