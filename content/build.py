# Assemble public/bank.json from the per-course modules in content/.
import json, importlib.util, pathlib, sys
here = pathlib.Path(__file__).parent
bank = json.loads((here.parent / "public/bank.json").read_text())
courses = bank["courses"]
qs, seen = [], set()
for f in sorted(here.glob("*.py")):
    if f.name == "build.py": continue
    spec = importlib.util.spec_from_file_location(f.stem, f); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    for q in m.Q:
        if q["id"] in seen: sys.exit(f"duplicate id {q['id']}")
        seen.add(q["id"]); qs.append({k: v for k, v in q.items() if v not in (None, [], "")})
# Keep hand-added questions (imports from class projects) that no module defines, but drop the old samples.
for q in bank["questions"]:
    if q["id"] not in seen and "-s0" not in q["id"]: qs.append(q)
bank["questions"] = qs
bank["version"] = bank.get("version", 1) + 1
(here.parent / "public/bank.json").write_text(json.dumps(bank, ensure_ascii=False, indent=1))
print(len(qs), "questions, version", bank["version"])
