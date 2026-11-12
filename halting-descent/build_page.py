"""Inject the recorded results into page.template.html -> page.html"""
import base64, json, numpy as np
bb5 = json.load(open("out/bb5_summary.json"))
img = np.fromfile("out/bb5_img.bin", dtype=np.float32).reshape(-1, bb5["cols"])[: bb5["rows"]]
img8 = (np.clip(img, 0, 1) * 255).astype(np.uint8)
runs = []
for tag in ("bb5_eta08", "bb5", "bb5_eta12"):
    s = json.load(open(f"out/{tag}_summary.json"))
    runs.append({k: s[k] for k in ("eta", "first_zero_loss_step", "ones", "halted", "margin_min")})
bb5.pop("head")
data = dict(bb5=bb5, img=base64.b64encode(img8.tobytes()).decode(), lr_runs=runs,
            robust=json.load(open("out/robustness.json")))
html = open("page.template.html").read().replace("/*DATA*/null", json.dumps(data, separators=(",", ":")))
open("page.html", "w").write(html)
print(len(html) // 1024, "KB")
