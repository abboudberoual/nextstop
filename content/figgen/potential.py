# Exam-style potential-flow sketches. Streamlines are contours of the actual psi; output is compact SVG using currentColor.
import numpy as np, matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt, json, pathlib
W, H = 320, 200; X0, X1, Y0, Y1 = -3.2, 3.2, -2.0, 2.0
sx = lambda x: (x - X0) / (X1 - X0) * W; sy = lambda y: H - (y - Y0) / (Y1 - Y0) * H
x, y = np.meshgrid(np.linspace(X0, X1, 500), np.linspace(Y0, Y1, 320)); r = np.hypot(x, y); th = np.arctan2(y, x)
U, a = 1.0, 1.0

def paths(psi, levels, mask=None):
    psi = np.where(mask, np.nan, psi) if mask is not None else psi
    cs = plt.contour(x, y, psi, levels=sorted(levels)); out = []
    for segs in cs.allsegs:
        for s in segs:
            if len(s) < 4: continue
            s = s[::max(1, len(s) // 120)]
            out.append("M" + " L".join(f"{sx(p[0]):.1f},{sy(p[1]):.1f}" for p in s))
    plt.close("all"); return out

def svg(name, streams, body="", extra="", dividing=None, label=""):
    sl = "".join(f'<path d="{d}"/>' for d in streams)
    dv = "".join(f'<path d="{d}"/>' for d in (dividing or []))
    axes = f'<line x1="0" y1="{sy(0):.0f}" x2="{W}" y2="{sy(0):.0f}" stroke-dasharray="3 3" opacity=".45"/><line x1="{sx(0):.0f}" y1="0" x2="{sx(0):.0f}" y2="{H}" stroke-dasharray="3 3" opacity=".45"/>'
    uarrow = f'<g stroke-width="2"><line x1="8" y1="22" x2="40" y2="22"/><path d="M40,22 l-7,-4 v8z" fill="currentColor"/></g><text x="10" y="15">U</text>'
    s = (f'<svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="{label}" fill="none" stroke="currentColor" '
         f'font-family="Source Sans 3,Segoe UI,sans-serif" font-size="12"><g stroke-width="1" opacity=".55">{sl}</g>{axes}'
         f'<g stroke-width="2.2">{dv}</g>{body}<g stroke="none" fill="currentColor">{extra}</g><g fill="currentColor" stroke="currentColor">{uarrow}</g>'
         f'<text x="{W-14}" y="{sy(0)-6:.0f}" fill="currentColor" stroke="none">x</text><text x="{sx(0)+5:.0f}" y="12" fill="currentColor" stroke="none">y</text></svg>')
    return s

def stag(xs, ys):
    return "".join(f'<circle cx="{sx(a_):.1f}" cy="{sy(b_):.1f}" r="3.5"/>' for a_, b_ in zip(xs, ys))

F = {}
# Uniform + source (half body): psi = U r sin th + m th/(2pi), stagnation at x=-b, b = m/(2 pi U)
m = 2 * np.pi * U * 0.7; b = m / (2 * np.pi * U)
psi = U * y + m / (2 * np.pi) * th
lv = np.linspace(-2.0, 2.0, 15); lv = lv[np.abs(lv) > 0.05]
tt = np.linspace(0.04, np.pi - 1e-3, 160); rb = b * (np.pi - tt) / np.sin(tt)
bx = np.concatenate([rb*np.cos(tt), (rb*np.cos(tt))[::-1]]); by = np.concatenate([rb*np.sin(tt), -(rb*np.sin(tt))[::-1]])
keep = (bx < X1) & (np.abs(by) < Y1); bx, by = bx[keep], by[keep]
body_d = ["M" + " L".join(f"{sx(p):.1f},{sy(q):.1f}" for p, q in zip(bx, by))]
with np.errstate(divide='ignore', invalid='ignore'):
    rb_field = np.where(np.abs(th) < 1e-6, np.inf, b * (np.pi - np.abs(th)) / np.sin(np.abs(th)))
inside = r < rb_field
F["half_body"] = svg("half_body", paths(np.where(np.abs(th) > np.pi - 0.03, np.nan, psi), [sg*(m/2+d) for sg in (1,-1) for d in np.linspace(0.25, 1.75, 6)], mask=inside), body=f'<path d="{body_d[0]}" fill="currentColor" fill-opacity=".12" stroke-width="2.2"/>',
    extra=stag([-b], [0]) + f'<text x="{sx(-b)-14:.0f}" y="{sy(0)+16:.0f}">−b</text><circle cx="{sx(0):.1f}" cy="{sy(0):.1f}" r="2.5"/><text x="{sx(0)+5:.0f}" y="{sy(0)+14:.0f}">source m</text><text x="{sx(0.9):.0f}" y="{sy(0.9):.0f}">half-width → πb</text>',
    label="Rankine half-body: uniform flow plus source")
# Rankine oval: source at -a, sink at +a
m = 2 * np.pi * U * 0.6; A = 1.0
psi = U * y + m / (2 * np.pi) * (np.arctan2(y, x + A) - np.arctan2(y, x - A))
l = np.sqrt(A**2 + m * A / (np.pi * U))
from scipy.optimize import brentq
xs_ = np.linspace(-l, l, 121); ys_ = []
for xv in xs_:
    f = lambda yy: U*yy + m/(2*np.pi)*(np.arctan2(yy, xv + A) - np.arctan2(yy, xv - A))
    ys_.append(0.0 if abs(abs(xv) - l) < 1e-9 else brentq(f, 1e-9, 3.0))
ys_ = np.array(ys_); ox = np.concatenate([xs_, xs_[::-1]]); oy = np.concatenate([ys_, -ys_[::-1]])
oval_d = ["M" + " L".join(f"{sx(p):.1f},{sy(q):.1f}" for p, q in zip(ox, oy)) + "Z"]
inside_o = (np.abs(x) < l) & (np.abs(y) <= np.interp(x, xs_, ys_) + 0.02)
F["rankine_oval"] = svg("rankine_oval", paths(psi, lv[np.abs(lv) > 0.1], mask=inside_o), body=f'<path d="{oval_d[0]}" fill="currentColor" fill-opacity=".12" stroke-width="2.2"/>',
    extra=stag([-l, l], [0, 0]) + f'<circle cx="{sx(-A):.1f}" cy="{sy(0):.1f}" r="2.5"/><circle cx="{sx(A):.1f}" cy="{sy(0):.1f}" r="2.5"/><text x="{sx(-A)-10:.0f}" y="{sy(0)+15:.0f}">+m</text><text x="{sx(A)-8:.0f}" y="{sy(0)+15:.0f}">−m</text><text x="{sx(l)+4:.0f}" y="{sy(0)-6:.0f}">ℓ</text>',
    label="Rankine oval: uniform flow plus source and sink")
# Cylinder: uniform + doublet, psi = U sin th (r - a^2/r)
psi = U * np.sin(th) * (r - a**2 / r)
cyl = f'<circle cx="{sx(0):.1f}" cy="{sy(0):.1f}" r="{sx(a)-sx(0):.1f}" fill="currentColor" fill-opacity=".12" stroke-width="2.2"/>'
F["cylinder"] = svg("cylinder", paths(psi, lv, mask=r < a), body=cyl,
    extra=stag([-a, a], [0, 0]) + f'<text x="{sx(0.72):.0f}" y="{sy(0.82):.0f}">a</text>' ,
    label="Flow around a circular cylinder: uniform flow plus doublet")
# Rotating cylinder for three circulation levels: psi = U sin th (r - a^2/r) - Gamma/(2pi) ln r  (Gamma>0 clockwise per sheet sign makes...)
for key, ratio in [("rot_cyl_lt1", 0.5), ("rot_cyl_eq1", 1.0), ("rot_cyl_gt1", 1.2)]:
    G = ratio * 4 * np.pi * U * a
    psi = U * np.sin(th) * (r - a**2 / r) + G / (2 * np.pi) * np.log(r / a)
    # stagnation points: on surface sin(th) = -G/(4 pi U a) when ratio<=1 (lift up for clockwise circulation in this sign)
    if ratio <= 1:
        t1 = np.arcsin(-ratio); pts = ([a*np.cos(t1), a*np.cos(np.pi - t1)], [a*np.sin(t1), a*np.sin(np.pi - t1)])
    else:
        rs = (G / (4*np.pi*U) + np.sqrt((G/(4*np.pi*U))**2 - a**2)); pts = ([0], [-rs])
    lvls = np.linspace(-2.2, 2.2, 17)
    F[key] = svg(key, paths(psi, lvls, mask=r < a), body=cyl, extra=stag(*pts) + f'<text x="{sx(-3.0):.0f}" y="{H-8}">clockwise, |Γ|/(4πUa) = {ratio:g}</text>',
        label=f"Rotating cylinder, Gamma over 4 pi U a equals {ratio:g}")
# Basic blocks: source, free vortex, doublet
F["source"] = svg("source", [f'M{sx(0.15*np.cos(t)):.1f},{sy(0.15*np.sin(t)):.1f} L{sx(1.9*np.cos(t)):.1f},{sy(1.9*np.sin(t)):.1f}' for t in np.linspace(0, 2*np.pi, 13)[:-1]],
    extra=f'<circle cx="{sx(0):.1f}" cy="{sy(0):.1f}" r="3"/><text x="{sx(0.25):.0f}" y="{sy(-0.35):.0f}">+m</text>', label="Source: radial streamlines")
F["vortex"] = svg("vortex", [], body="".join(f'<circle cx="{sx(0):.1f}" cy="{sy(0):.1f}" r="{sx(R)-sx(0):.1f}" stroke-width="1" opacity=".55"/>' for R in (0.4, 0.8, 1.25, 1.75)),
    extra=f'<circle cx="{sx(0):.1f}" cy="{sy(0):.1f}" r="3"/><text x="{sx(0.2):.0f}" y="{sy(-0.25):.0f}">Γ</text>', label="Free vortex: circular streamlines")
psi = -np.sin(th) / r
F["doublet"] = svg("doublet", paths(psi, [v for v in np.linspace(-6, 6, 14) if abs(v) > .3], mask=r < 0.12), label="Doublet: circles tangent to the x-axis at the origin")
for k in list(F):
    F[k] = F[k].replace('<g fill="currentColor" stroke="currentColor">', '<g fill="currentColor" stroke="currentColor">' if k not in ("source","vortex","doublet") else '<g display="none">')
out = pathlib.Path(__file__).parent.parent / "figures.json"; out.write_text(json.dumps(F)); print({k: len(v) for k, v in F.items()})
# Accuracy checks (rule: verify numbers in Python)
import sympy as sp
R_, T_, Uu, aa, mm = sp.symbols('r theta U a m', positive=True)
psi_c = Uu*sp.sin(T_)*(R_-aa**2/R_); vth = -sp.diff(psi_c, R_); print("v_theta on r=a:", sp.simplify(vth.subs(R_, aa)))
Cp = 1 - (vth.subs(R_, aa)/Uu)**2; print("Cp surface:", sp.simplify(Cp))
xx = sp.symbols('x', positive=True); u_axis = Uu + mm/(2*sp.pi)*(1/(xx+aa) - 1/(xx-aa))
print("oval l^2:", sp.solve(sp.Eq(u_axis, 0), xx))
