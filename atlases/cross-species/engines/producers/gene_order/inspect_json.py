#!/usr/bin/env python3
"""inspect_json.py -- show the structure of a JSON file without assuming anything.
Prints top-level keys, the type/length of each, and a sample element of any list
that contains dicts (so we see the real block keys).
Usage: python inspect_json.py FILE.json
"""
import json, sys
data=json.load(open(sys.argv[1]))
def show(obj, indent=0, name="(root)"):
    pad="  "*indent
    if isinstance(obj, dict):
        print(f"{pad}{name}: dict with {len(obj)} keys: {list(obj.keys())}")
        for k,v in obj.items():
            if isinstance(v,(dict,list)):
                show(v, indent+1, k)
            else:
                print(f"{pad}  {k}: {type(v).__name__} = {repr(v)[:60]}")
    elif isinstance(obj, list):
        print(f"{pad}{name}: list of {len(obj)}")
        if obj and isinstance(obj[0], dict):
            print(f"{pad}  [0] keys: {list(obj[0].keys())}")
            print(f"{pad}  [0] sample: {json.dumps(obj[0])[:200]}")
        elif obj:
            print(f"{pad}  [0] = {repr(obj[0])[:80]}")
    else:
        print(f"{pad}{name}: {type(obj).__name__} = {repr(obj)[:60]}")
show(data)
