import { useState, useEffect } from "react";
import {
  Utensils, Heart, Sparkles, Home, ShoppingCart, Brush, Lock,
  Check, X, Plus, Minus, Trophy, Target, History,
  ChevronRight, HandHelping, MessageCircleOff,
  ClipboardCheck, Trash2, Edit3, ArrowLeft,
  Bike, Gift, Calendar, Frown, ThumbsDown, Ban,
  LogOut, User, UserPlus, Users, Shield, KeyRound, AlertCircle
} from "lucide-react";
import * as storage from "./storage.js";

const STORAGE_KEY = "bike-challenge-v1";
const DEFAULT_BIKE_IMAGE = "/bike.jpg";
const HASH_SALT = "bike-challenge-2026:";

// -------------------- Defaults --------------------

const DEFAULT_TASKS = [
  { id: "t1", name: "Ate all my dinner", points: 20, type: "daily", icon: "Utensils", parentOnly: false },
  { id: "t2", name: "Tried a new healthy food", points: 15, type: "daily", icon: "Sparkles", parentOnly: false },
  { id: "t3", name: "Cleaned up my room", points: 20, type: "daily", icon: "Home", parentOnly: false },
  { id: "t4", name: "Helped with chores", points: 15, type: "repeatable", icon: "Brush", parentOnly: false },
  { id: "t5", name: "Helped without being asked", points: 25, type: "repeatable", icon: "HandHelping", parentOnly: false },
  { id: "t6", name: "Made a good food choice shopping", points: 25, type: "repeatable", icon: "ShoppingCart", parentOnly: false },
  { id: "t7", name: "Was kind to brother today", points: 30, type: "daily", icon: "Heart", parentOnly: true },
  { id: "t8", name: "No answering back today", points: 30, type: "daily", icon: "MessageCircleOff", parentOnly: true },
  { id: "t9", name: "Made own decision at shops", points: 20, type: "repeatable", icon: "ClipboardCheck", parentOnly: true },
];

const DEFAULT_DEDUCTIONS = [
  { id: "d1", name: "Rude to Mum", points: 20, icon: "Frown" },
  { id: "d2", name: "Rude to Eli", points: 20, icon: "Frown" },
  { id: "d3", name: "Rude to Dad", points: 20, icon: "Frown" },
];

function todayKey() { return new Date().toISOString().slice(0, 10); }

function defaultChristmasEndDate() {
  const now = new Date();
  const past = (now.getMonth() === 11 && now.getDate() > 25);
  const year = past ? now.getFullYear() + 1 : now.getFullYear();
  return `${year}-12-25`;
}

function makeDefaultGoal() {
  return {
    name: "DHZ Electric Dirt Bike",
    imageUrl: DEFAULT_BIKE_IMAGE,
    thresholdPct: 60,
    startDate: todayKey(),
    endDate: defaultChristmasEndDate(),
    earnedPoints: 0,
  };
}

function makeDefaultChildData() {
  return {
    tasks: JSON.parse(JSON.stringify(DEFAULT_TASKS)),
    deductions: JSON.parse(JSON.stringify(DEFAULT_DEDUCTIONS)),
    pending: [],
    history: [],
    completedToday: [],
    lastResetDate: todayKey(),
    goal: makeDefaultGoal(),
  };
}

const ICON_MAP = {
  Utensils, Heart, Sparkles, Home, ShoppingCart, Brush, HandHelping,
  MessageCircleOff, ClipboardCheck, Trophy, Target, Bike, Gift,
  Frown, ThumbsDown, Ban
};

// -------------------- Helpers --------------------

function formatTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function uid() { return Math.random().toString(36).slice(2, 10); }

async function hashPassword(plain) {
  if (!plain) return "";
  const encoder = new TextEncoder();
  const buffer = encoder.encode(HASH_SALT + plain);
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function bump(goal, delta) {
  if (!goal) return goal;
  return { ...goal, earnedPoints: Math.max(0, (goal.earnedPoints || 0) + delta) };
}

function daysBetween(a, b) { return Math.max(1, Math.ceil((new Date(b) - new Date(a)) / 86400000)); }
function daysRemaining(end) { return Math.max(0, Math.ceil((new Date(end) - new Date()) / 86400000)); }

function calcStats(goal, tasks) {
  if (!goal) return null;
  const days = daysBetween(goal.startDate, goal.endDate);
  const ptsPerDay = (tasks || []).filter(t => t.type === "daily").reduce((s, t) => s + (t.points || 0), 0);
  const totalAvailable = ptsPerDay * days;
  const threshold = Math.max(1, Math.ceil(totalAvailable * (goal.thresholdPct / 100)));
  const earned = Math.max(0, goal.earnedPoints || 0);
  const pct = Math.min(100, (earned / threshold) * 100);
  return { days, totalAvailable, threshold, earned, pct, won: earned >= threshold, remaining: Math.max(0, threshold - earned), ptsPerDay };
}

// -------------------- Migration --------------------

async function migrateIfNeeded(blob) {
  if (blob.children && blob.admin) return blob; // already new format
  // Old single-child format: rebuild as multi-user
  const oldKidName = blob.config?.kidName || "Champ";
  const childData = {
    tasks: blob.tasks || JSON.parse(JSON.stringify(DEFAULT_TASKS)),
    deductions: blob.deductions || JSON.parse(JSON.stringify(DEFAULT_DEDUCTIONS)),
    pending: blob.pending || [],
    history: blob.history || [],
    completedToday: blob.completedToday || [],
    lastResetDate: blob.lastResetDate || todayKey(),
    goal: blob.goal || makeDefaultGoal(),
  };
  return {
    admin: {
      username: "admin",
      passwordHash: await hashPassword("admin"),
    },
    children: [{
      id: uid(),
      username: oldKidName.toLowerCase().replace(/[^a-z0-9]/g, "") || "kid",
      passwordHash: await hashPassword("password"),
      displayName: oldKidName,
      data: childData,
    }],
  };
}

async function initFresh() {
  return {
    admin: { username: "admin", passwordHash: await hashPassword("admin") },
    children: [],
  };
}

// -------------------- Main App --------------------

export default function App() {
  const [data, setData] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [session, setSession] = useState(null); // null | { role: 'admin' } | { role: 'child', childId }
  const [toast, setToast] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const result = await storage.get(STORAGE_KEY);
        let blob;
        if (result && result.value) {
          blob = JSON.parse(result.value);
          blob = await migrateIfNeeded(blob);
        } else {
          blob = await initFresh();
        }
        // Daily reset per child
        const today = todayKey();
        blob.children = blob.children.map(c => {
          if (c.data.lastResetDate !== today) {
            return { ...c, data: { ...c.data, completedToday: [], lastResetDate: today } };
          }
          return c;
        });
        setData(blob);
      } catch (e) {
        console.error("load failed", e);
        setData(await initFresh());
      }
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded || !data) return;
    storage.set(STORAGE_KEY, JSON.stringify(data));
  }, [data, loaded]);

  const showToast = (msg, kind = "info") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2500);
  };

  if (!loaded || !data) {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><div className="text-slate-500">Loading...</div></div>;
  }

  let body;
  if (!session) {
    body = <LoginView data={data} onLogin={setSession} />;
  } else if (session.role === "admin") {
    body = <AdminApp data={data} setData={setData} onLogout={() => setSession(null)} showToast={showToast} />;
  } else if (session.role === "child") {
    const child = data.children.find(c => c.id === session.childId);
    if (!child) {
      setSession(null);
      body = <div />;
    } else {
      const updateChildData = (newChildData) => {
        setData({
          ...data,
          children: data.children.map(c => c.id === child.id ? { ...c, data: newChildData } : c),
        });
      };
      body = <ChildApp child={child} setChildData={updateChildData} onLogout={() => setSession(null)} showToast={showToast} />;
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 font-sans">
      <div className="max-w-md mx-auto px-3 pt-3 pb-20 sm:px-4 sm:max-w-2xl">
        {body}
        {toast && (
          <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-full shadow-lg text-white text-sm font-medium z-50 max-w-[90%] text-center ${
            toast.kind === "success" ? "bg-emerald-600" :
            toast.kind === "warn" ? "bg-amber-600" : "bg-slate-700"
          }`}>{toast.msg}</div>
        )}
      </div>
    </div>
  );
}

// -------------------- Login --------------------

function LoginView({ data, onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!username || !password) { setError("Enter username and password"); return; }
    setBusy(true);
    try {
      const hash = await hashPassword(password);
      const u = username.trim().toLowerCase();
      if (u === data.admin.username.toLowerCase() && hash === data.admin.passwordHash) {
        onLogin({ role: "admin" });
        return;
      }
      const child = data.children.find(c => c.username.toLowerCase() === u && c.passwordHash === hash);
      if (child) { onLogin({ role: "child", childId: child.id }); return; }
      setError("Wrong username or password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-12">
      <div className="text-center mb-6">
        <div className="inline-flex p-3 bg-teal-700 rounded-full mb-3"><Bike size={28} className="text-white" /></div>
        <h1 className="text-2xl font-bold text-slate-800">Bike Challenge</h1>
        <p className="text-sm text-slate-500 mt-1">Sign in to keep going</p>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-sm">
        <div>
          <label className="text-xs text-slate-500 block mb-1">Username</label>
          <input
            value={username}
            onChange={(e) => { setUsername(e.target.value); setError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            autoCapitalize="none"
            autoCorrect="off"
            className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-teal-500"
            placeholder="e.g. admin or your name"
          />
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-teal-500"
            placeholder="••••••••"
          />
        </div>
        {error && <p className="text-rose-600 text-sm text-center">{error}</p>}
        <button
          onClick={submit}
          disabled={busy}
          className="w-full bg-teal-700 active:bg-teal-800 disabled:opacity-50 text-white font-semibold py-3 rounded-xl"
        >
          {busy ? "Signing in..." : "Sign in"}
        </button>
      </div>
      {data.children.length === 0 && (
        <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900">
          <p className="font-semibold mb-1">First-time setup</p>
          <p>Default admin login: <span className="font-mono">admin</span> / <span className="font-mono">admin</span> — change it immediately after signing in.</p>
        </div>
      )}
    </div>
  );
}

// -------------------- Admin --------------------

function AdminApp({ data, setData, onLogout, showToast }) {
  const [view, setView] = useState({ kind: "home" }); // home | child | account

  if (view.kind === "child") {
    const child = data.children.find(c => c.id === view.childId);
    if (!child) { setView({ kind: "home" }); return null; }
    const setChildData = (newChildData) => {
      setData({ ...data, children: data.children.map(c => c.id === child.id ? { ...c, data: newChildData } : c) });
    };
    const updateChildMeta = (updates) => {
      setData({ ...data, children: data.children.map(c => c.id === child.id ? { ...c, ...updates } : c) });
    };
    const deleteChild = () => {
      setData({ ...data, children: data.children.filter(c => c.id !== child.id) });
      setView({ kind: "home" });
      showToast(`${child.displayName} removed`, "warn");
    };
    return (
      <ChildAdminPanel
        child={child}
        setChildData={setChildData}
        onBack={() => setView({ kind: "home" })}
        updateChildMeta={updateChildMeta}
        deleteChild={deleteChild}
        showToast={showToast}
      />
    );
  }

  if (view.kind === "account") {
    return <AdminAccount data={data} setData={setData} onBack={() => setView({ kind: "home" })} showToast={showToast} />;
  }

  return <AdminHome data={data} setData={setData} onLogout={onLogout} setView={setView} showToast={showToast} />;
}

function AdminHome({ data, setData, onLogout, setView, showToast }) {
  const [showAdd, setShowAdd] = useState(false);
  const allPending = data.children.flatMap(c => c.data.pending.map(p => ({ ...p, _childId: c.id, _childName: c.displayName })));

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Shield size={20} className="text-teal-700" /> Admin</h1>
          <p className="text-xs text-slate-500">Manage children and approvals</p>
        </div>
        <button onClick={onLogout} className="p-2.5 rounded-full bg-white border border-slate-200 active:bg-slate-100" aria-label="Log out">
          <LogOut size={18} className="text-slate-600" />
        </button>
      </header>

      {allPending.length > 0 && (
        <section>
          <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2 px-1">Pending approvals ({allPending.length})</h2>
          <div className="space-y-2">
            {allPending.map(p => (
              <button
                key={p.id}
                onClick={() => setView({ kind: "child", childId: p._childId })}
                className="w-full text-left bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center justify-between active:bg-amber-100"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-amber-900 text-sm truncate">{p.taskName}</p>
                  <p className="text-[11px] text-amber-700">{p._childName} · {formatTime(p.requestedAt)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <span className="text-amber-700 font-bold text-sm">+{p.points}</span>
                  <ChevronRight size={16} className="text-amber-600" />
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2 px-1 flex items-center gap-1"><Users size={12} /> Children ({data.children.length})</h2>
        {data.children.length === 0 && !showAdd && (
          <div className="bg-white rounded-2xl p-6 text-center border border-slate-200">
            <UserPlus size={32} className="text-slate-300 mx-auto mb-2" />
            <p className="text-slate-500 text-sm mb-3">No children yet</p>
            <button onClick={() => setShowAdd(true)} className="bg-teal-700 active:bg-teal-800 text-white font-semibold py-2 px-4 rounded-lg text-sm">Add your first child</button>
          </div>
        )}
        <div className="space-y-2">
          {data.children.map(c => {
            const stats = calcStats(c.data.goal, c.data.tasks);
            const pendingCount = c.data.pending.length;
            return (
              <button
                key={c.id}
                onClick={() => setView({ kind: "child", childId: c.id })}
                className="w-full text-left bg-white border border-slate-200 rounded-xl p-3 active:bg-slate-50"
              >
                <div className="flex items-center gap-3">
                  {c.data.goal?.imageUrl && (
                    <img src={c.data.goal.imageUrl} alt="" className="w-12 h-12 object-contain rounded-lg bg-slate-50 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-semibold text-slate-800 text-sm truncate">{c.displayName}</p>
                      {pendingCount > 0 && (
                        <span className="text-[10px] bg-rose-500 text-white px-1.5 py-0.5 rounded-full shrink-0">{pendingCount} pending</span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500">@{c.username}</p>
                    {stats && (
                      <>
                        <div className="w-full bg-slate-100 rounded-full h-1.5 mt-1.5">
                          <div className="h-full bg-gradient-to-r from-teal-500 to-emerald-500 rounded-full" style={{ width: `${stats.pct}%` }} />
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1">{stats.earned.toLocaleString()} / {stats.threshold.toLocaleString()} ({Math.round(stats.pct)}%)</p>
                      </>
                    )}
                  </div>
                  <ChevronRight size={18} className="text-slate-400 shrink-0" />
                </div>
              </button>
            );
          })}
        </div>

        {showAdd ? (
          <AddChildForm data={data} setData={setData} onDone={() => setShowAdd(false)} showToast={showToast} />
        ) : (
          data.children.length > 0 && (
            <button onClick={() => setShowAdd(true)} className="w-full mt-2 bg-teal-700 active:bg-teal-800 text-white font-semibold py-2.5 rounded-xl flex items-center justify-center gap-2 text-sm">
              <UserPlus size={16} /> Add another child
            </button>
          )
        )}
      </section>

      <section>
        <button onClick={() => setView({ kind: "account" })} className="w-full bg-white border border-slate-200 rounded-xl p-3 flex items-center gap-3 active:bg-slate-50">
          <KeyRound size={18} className="text-slate-600" />
          <span className="font-medium text-slate-800 text-sm flex-1 text-left">My admin account</span>
          <ChevronRight size={18} className="text-slate-400" />
        </button>
      </section>
    </div>
  );
}

function AddChildForm({ data, setData, onDone, showToast }) {
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const u = username.trim().toLowerCase();
    if (!displayName.trim() || !u || !password) { showToast("All fields required", "warn"); return; }
    if (u === data.admin.username.toLowerCase()) { showToast("That username is taken (admin)", "warn"); return; }
    if (data.children.some(c => c.username.toLowerCase() === u)) { showToast("Username already in use", "warn"); return; }
    setBusy(true);
    const passwordHash = await hashPassword(password);
    const newChild = {
      id: uid(),
      username: u,
      passwordHash,
      displayName: displayName.trim(),
      data: makeDefaultChildData(),
    };
    setData({ ...data, children: [...data.children, newChild] });
    setBusy(false);
    showToast(`${displayName} added`, "success");
    onDone();
  };

  return (
    <div className="mt-2 bg-white border-2 border-teal-300 rounded-2xl p-3 space-y-2.5">
      <h3 className="font-semibold text-slate-800 text-sm">Add child</h3>
      <div>
        <label className="text-[11px] text-slate-500 block mb-1">Display name (shown in greeting)</label>
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm" placeholder="e.g. Tom" />
      </div>
      <div>
        <label className="text-[11px] text-slate-500 block mb-1">Username (for login)</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm" placeholder="e.g. tom" />
      </div>
      <div>
        <label className="text-[11px] text-slate-500 block mb-1">Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Something he can remember" />
      </div>
      <div className="flex gap-2">
        <button onClick={save} disabled={busy} className="flex-1 bg-teal-700 active:bg-teal-800 text-white font-semibold py-2 rounded-lg text-sm disabled:opacity-50">Save</button>
        <button onClick={onDone} className="flex-1 bg-white border border-slate-300 text-slate-700 font-medium py-2 rounded-lg text-sm">Cancel</button>
      </div>
    </div>
  );
}

function AdminAccount({ data, setData, onBack, showToast }) {
  const [username, setUsername] = useState(data.admin.username);
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const u = username.trim().toLowerCase();
      if (!u) { showToast("Username required", "warn"); return; }
      if (data.children.some(c => c.username.toLowerCase() === u)) { showToast("That username is taken by a child", "warn"); return; }

      // If changing password, verify current
      let passwordHash = data.admin.passwordHash;
      if (newPwd) {
        const currentHash = await hashPassword(currentPwd);
        if (currentHash !== data.admin.passwordHash) { showToast("Current password wrong", "warn"); return; }
        passwordHash = await hashPassword(newPwd);
      }

      setData({ ...data, admin: { username: u, passwordHash } });
      showToast("Admin account updated", "success");
      onBack();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2">
        <button onClick={onBack} className="p-2 rounded-full active:bg-slate-100"><ArrowLeft size={18} /></button>
        <h1 className="text-lg font-bold text-slate-800">My admin account</h1>
      </header>
      <section className="bg-white border border-slate-200 rounded-2xl p-3 space-y-2.5">
        <div>
          <label className="text-[11px] text-slate-500 block mb-1">Username</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm" />
        </div>
        <hr className="border-slate-200" />
        <p className="text-[11px] text-slate-500">Leave blank to keep current password</p>
        <div>
          <label className="text-[11px] text-slate-500 block mb-1">Current password</label>
          <input type="password" value={currentPwd} onChange={(e) => setCurrentPwd(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="text-[11px] text-slate-500 block mb-1">New password</label>
          <input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm" />
        </div>
        <button onClick={save} disabled={busy} className="w-full bg-teal-700 active:bg-teal-800 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm">Save</button>
      </section>
    </div>
  );
}

// -------------------- Child Admin Panel (admin viewing a child) --------------------

function ChildAdminPanel({ child, setChildData, onBack, updateChildMeta, deleteChild, showToast }) {
  const [tab, setTab] = useState("pending");
  const data = child.data;
  const setData = setChildData; // alias so existing tab components work

  const approvePending = (p) => {
    const h = { id: uid(), type: "earned", taskName: p.taskName, points: p.points, at: new Date().toISOString() };
    setData({
      ...data,
      pending: data.pending.filter(x => x.id !== p.id),
      history: [h, ...data.history],
      goal: bump(data.goal, p.points),
    });
    showToast(`+${p.points} pts · bike closer!`, "success");
  };

  const rejectPending = (p) => {
    setData({
      ...data,
      pending: data.pending.filter(x => x.id !== p.id),
      completedToday: data.completedToday.filter(id => id !== p.taskId),
    });
    showToast("Rejected", "warn");
  };

  const directAward = (task) => {
    const h = { id: uid(), type: "earned", taskName: task.name, points: task.points, at: new Date().toISOString() };
    const newCompleted = task.type === "daily" && !data.completedToday.includes(task.id) ? [...data.completedToday, task.id] : data.completedToday;
    setData({
      ...data,
      history: [h, ...data.history],
      completedToday: newCompleted,
      goal: bump(data.goal, task.points),
    });
    showToast(`+${task.points} for "${task.name}"`, "success");
  };

  const deductPoints = (amount, reason) => {
    if (amount <= 0) return;
    const h = { id: uid(), type: "deducted", taskName: reason || "Deduction", points: -amount, at: new Date().toISOString() };
    setData({
      ...data,
      history: [h, ...data.history],
      goal: bump(data.goal, -amount),
    });
    showToast(`-${amount} pts · bike further away`, "warn");
  };

  const stats = calcStats(data.goal, data.tasks);
  const pendingCount = data.pending.length;

  return (
    <div className="space-y-3">
      <header className="flex items-center gap-2">
        <button onClick={onBack} className="p-2 rounded-full active:bg-slate-100"><ArrowLeft size={18} /></button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-slate-800 truncate">{child.displayName}</h1>
          <p className="text-[11px] text-slate-500">@{child.username}</p>
        </div>
      </header>

      {stats && (
        <div className="bg-white border border-slate-200 rounded-xl p-2.5 flex items-center gap-3">
          {data.goal.imageUrl && <img src={data.goal.imageUrl} alt="" className="w-12 h-12 object-contain rounded-lg bg-slate-50 shrink-0" />}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-semibold text-slate-800 text-sm truncate">{data.goal.name}</p>
              <p className="text-[11px] text-slate-500 shrink-0">{daysRemaining(data.goal.endDate)}d</p>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2 mt-1">
              <div className="h-full bg-gradient-to-r from-teal-500 to-emerald-500 rounded-full" style={{ width: `${stats.pct}%` }} />
            </div>
            <p className="text-[11px] text-slate-500 mt-1">{stats.earned.toLocaleString()} / {stats.threshold.toLocaleString()} ({Math.round(stats.pct)}%)</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-1 flex gap-1 overflow-x-auto -mx-1 px-1">
        <TabBtn active={tab === "pending"} onClick={() => setTab("pending")} badge={pendingCount}>Approvals</TabBtn>
        <TabBtn active={tab === "award"} onClick={() => setTab("award")}>Award</TabBtn>
        <TabBtn active={tab === "manage"} onClick={() => setTab("manage")}>Tasks</TabBtn>
        <TabBtn active={tab === "history"} onClick={() => setTab("history")}>History</TabBtn>
        <TabBtn active={tab === "settings"} onClick={() => setTab("settings")}>Settings</TabBtn>
      </div>

      {tab === "pending" && <PendingTab data={data} onApprove={approvePending} onReject={rejectPending} />}
      {tab === "award" && <AwardTab data={data} onDirectAward={directAward} onDeduct={deductPoints} />}
      {tab === "manage" && <ManageTasksTab data={data} setData={setData} showToast={showToast} />}
      {tab === "history" && <HistoryTab data={data} />}
      {tab === "settings" && <ChildSettingsTab child={child} data={data} setData={setData} updateChildMeta={updateChildMeta} deleteChild={deleteChild} showToast={showToast} />}
    </div>
  );
}

// -------------------- Child App (kid logged in as themselves) --------------------

function ChildApp({ child, setChildData, onLogout, showToast }) {
  const data = child.data;
  const setData = setChildData;

  const requestTask = (task) => {
    if (task.parentOnly) return;
    if (task.type === "daily" && data.completedToday.includes(task.id)) {
      showToast("Already submitted today", "warn"); return;
    }
    if (data.pending.some(p => p.taskId === task.id)) {
      showToast("Already waiting for approval", "warn"); return;
    }
    const pendingItem = { id: uid(), taskId: task.id, taskName: task.name, points: task.points, requestedAt: new Date().toISOString() };
    const newCompleted = task.type === "daily" ? [...data.completedToday, task.id] : data.completedToday;
    setData({ ...data, pending: [...data.pending, pendingItem], completedToday: newCompleted });
    showToast("Sent for approval", "success");
  };

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-slate-800 truncate">Hi {child.displayName}!</h1>
          <p className="text-xs text-slate-500">Tap things you've done</p>
        </div>
        <button onClick={onLogout} className="p-2.5 rounded-full bg-white shadow-sm border border-slate-200 text-slate-600 active:bg-slate-100 shrink-0" aria-label="Log out">
          <LogOut size={18} />
        </button>
      </header>
      <KidView data={data} onRequestTask={requestTask} />
    </div>
  );
}

// -------------------- Shared components (KidView, tabs, cards) --------------------

function GoalHero({ goal, stats }) {
  const daysLeft = daysRemaining(goal.endDate);
  const { earned, threshold, pct, won, remaining } = stats;

  let mood;
  if (won) mood = { tag: "YOU'VE EARNED THE BIKE! 🎉", color: "from-emerald-500 to-emerald-700" };
  else if (pct >= 80) mood = { tag: "So close — keep going!", color: "from-amber-500 to-orange-600" };
  else if (pct >= 50) mood = { tag: "Halfway there!", color: "from-sky-500 to-indigo-600" };
  else if (pct >= 20) mood = { tag: "Making progress", color: "from-indigo-500 to-purple-600" };
  else mood = { tag: "Let's get started!", color: "from-slate-600 to-slate-800" };

  return (
    <div className="rounded-2xl overflow-hidden shadow-md border border-slate-200 bg-white">
      <div className="relative bg-gradient-to-br from-slate-100 to-slate-200 aspect-[5/3]">
        {goal.imageUrl ? <img src={goal.imageUrl} alt={goal.name} className="w-full h-full object-contain" /> : (
          <div className="w-full h-full flex items-center justify-center"><Gift size={64} className="text-slate-400" /></div>
        )}
        <div className="absolute top-2 left-2 bg-white/90 backdrop-blur px-2.5 py-1 rounded-full text-[11px] font-semibold text-slate-700 flex items-center gap-1"><Gift size={12} /> Christmas Goal</div>
        <div className="absolute top-2 right-2 bg-white/90 backdrop-blur px-2.5 py-1 rounded-full text-[11px] font-semibold text-slate-700 flex items-center gap-1"><Calendar size={12} /> {daysLeft}d</div>
      </div>
      <div className="p-3 sm:p-4">
        <h2 className="font-bold text-slate-800 text-base sm:text-lg leading-tight">{goal.name}</h2>
        <p className={`text-xs sm:text-sm font-semibold bg-gradient-to-r ${mood.color} bg-clip-text text-transparent mt-0.5`}>{mood.tag}</p>
        <div className="mt-3">
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-xl sm:text-2xl font-bold text-slate-800">{earned.toLocaleString()}</span>
            <span className="text-xs text-slate-500">of {threshold.toLocaleString()} pts</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
            <div className={`h-full bg-gradient-to-r ${mood.color} rounded-full transition-all duration-700 ease-out`} style={{ width: `${pct}%` }} />
          </div>
          <div className="flex justify-between text-[11px] text-slate-500 mt-1">
            <span>{Math.round(pct)}% there</span>
            {!won && <span>{remaining.toLocaleString()} pts to go</span>}
          </div>
        </div>
        {won && <div className="mt-3 p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-center"><p className="text-emerald-900 font-bold text-sm">🎁 The bike is yours this Christmas!</p></div>}
      </div>
    </div>
  );
}

function KidView({ data, onRequestTask }) {
  const kidTasks = data.tasks.filter(t => !t.parentOnly);
  const dailyTasks = kidTasks.filter(t => t.type === "daily");
  const repeatTasks = kidTasks.filter(t => t.type === "repeatable");
  const stats = calcStats(data.goal, data.tasks);

  return (
    <div className="space-y-4">
      {stats && <GoalHero goal={data.goal} stats={stats} />}

      {data.pending.length > 0 && (
        <section>
          <SectionHeader>Waiting for approval ({data.pending.length})</SectionHeader>
          <div className="space-y-2">
            {data.pending.map(p => (
              <div key={p.id} className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-amber-900 text-sm truncate">{p.taskName}</p>
                  <p className="text-[11px] text-amber-700">{formatTime(p.requestedAt)}</p>
                </div>
                <span className="text-amber-700 font-bold text-sm shrink-0 ml-2">+{p.points}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {dailyTasks.length > 0 && (
        <section>
          <SectionHeader>Today's tasks</SectionHeader>
          <div className="space-y-2">
            {dailyTasks.map(task => {
              const done = data.completedToday.includes(task.id);
              return <TaskCard key={task.id} task={task} done={done} onTap={() => onRequestTask(task)} />;
            })}
          </div>
        </section>
      )}

      {repeatTasks.length > 0 && (
        <section>
          <SectionHeader>Bonus tasks (anytime)</SectionHeader>
          <div className="space-y-2">
            {repeatTasks.map(task => (
              <TaskCard key={task.id} task={task} done={data.pending.some(p => p.taskId === task.id)} doneLabel="Pending" onTap={() => onRequestTask(task)} />
            ))}
          </div>
        </section>
      )}

      {data.deductions && data.deductions.length > 0 && (
        <section>
          <SectionHeader>Lose points if you do these</SectionHeader>
          <div className="space-y-2">
            {data.deductions.map(d => <DeductionCard key={d.id} d={d} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function SectionHeader({ children }) {
  return <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2 px-1">{children}</h3>;
}

function TaskCard({ task, done, doneLabel = "Done today ✓", onTap }) {
  const Icon = ICON_MAP[task.icon] || Sparkles;
  return (
    <button onClick={onTap} disabled={done} className={`w-full text-left rounded-xl p-3 border flex items-center gap-3 min-h-[64px] ${
      done ? "bg-slate-100 border-slate-200 opacity-60" : "bg-white border-slate-200 active:bg-teal-50 active:border-teal-400"
    }`}>
      <div className={`p-2 rounded-lg shrink-0 ${done ? "bg-slate-200" : "bg-teal-50"}`}>
        <Icon size={20} className={done ? "text-slate-500" : "text-teal-700"} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-slate-800 text-sm leading-tight truncate">{task.name}</p>
        <p className="text-[11px] text-slate-500 mt-0.5">{done ? doneLabel : "Tap when you've done it"}</p>
      </div>
      <div className="flex items-center gap-1 bg-amber-100 px-2 py-1 rounded-full shrink-0">
        <Trophy size={12} className="text-amber-700" />
        <span className="font-bold text-amber-900 text-xs">{task.points}</span>
      </div>
    </button>
  );
}

function DeductionCard({ d }) {
  const Icon = ICON_MAP[d.icon] || Frown;
  return (
    <div className="w-full rounded-xl p-3 border border-rose-200 bg-rose-50 flex items-center gap-3">
      <div className="p-2 rounded-lg bg-rose-100 shrink-0"><Icon size={20} className="text-rose-700" /></div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-rose-900 text-sm leading-tight truncate">{d.name}</p>
        <p className="text-[11px] text-rose-700 mt-0.5">Loses points</p>
      </div>
      <div className="flex items-center gap-1 bg-rose-200 px-2 py-1 rounded-full shrink-0">
        <span className="font-bold text-rose-900 text-xs">−{d.points}</span>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children, badge }) {
  return (
    <button onClick={onClick} className={`whitespace-nowrap px-3 py-2 text-xs sm:text-sm rounded-lg font-medium relative shrink-0 ${
      active ? "bg-teal-700 text-white" : "text-slate-600 active:bg-slate-100"
    }`}>
      {children}
      {badge > 0 && <span className={`ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] rounded-full ${active ? "bg-white text-teal-700" : "bg-rose-500 text-white"}`}>{badge}</span>}
    </button>
  );
}

function PendingTab({ data, onApprove, onReject }) {
  if (data.pending.length === 0) {
    return <div className="bg-white rounded-2xl p-6 text-center border border-slate-200"><ClipboardCheck size={32} className="text-slate-300 mx-auto mb-2" /><p className="text-slate-500 text-sm">Nothing waiting for approval</p></div>;
  }
  return (
    <div className="space-y-2">
      {data.pending.map(p => (
        <div key={p.id} className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="mb-2">
            <p className="font-medium text-slate-800 text-sm">{p.taskName}</p>
            <p className="text-[11px] text-slate-500">Submitted {formatTime(p.requestedAt)} · {p.points} pts</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => onApprove(p)} className="flex-1 bg-emerald-600 active:bg-emerald-700 text-white font-medium py-2.5 rounded-lg flex items-center justify-center gap-1.5 text-sm"><Check size={16} /> Approve</button>
            <button onClick={() => onReject(p)} className="flex-1 bg-white border border-slate-300 active:bg-slate-50 text-slate-700 font-medium py-2.5 rounded-lg flex items-center justify-center gap-1.5 text-sm"><X size={16} /> Reject</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function AwardTab({ data, onDirectAward, onDeduct }) {
  const [customAmount, setCustomAmount] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [deductAmount, setDeductAmount] = useState("");
  const [deductReason, setDeductReason] = useState("");

  const handleAward = () => {
    const amt = parseInt(customAmount);
    if (!amt || amt <= 0) return;
    onDirectAward({ id: "custom", name: customReason || "Bonus", points: amt, type: "repeatable" });
    setCustomAmount(""); setCustomReason("");
  };

  const handleDeduct = () => {
    const amt = parseInt(deductAmount);
    if (!amt || amt <= 0) return;
    onDeduct(amt, deductReason || "Deduction");
    setDeductAmount(""); setDeductReason("");
  };

  const parentOnlyTasks = data.tasks.filter(t => t.parentOnly);

  return (
    <div className="space-y-3">
      <section className="bg-white border border-slate-200 rounded-2xl p-3">
        <h3 className="font-semibold text-slate-800 text-sm mb-1">Parent-only awards</h3>
        <p className="text-[11px] text-slate-500 mb-2">Award when you've seen the behaviour.</p>
        <div className="space-y-2">
          {parentOnlyTasks.map(task => {
            const Icon = ICON_MAP[task.icon] || Heart;
            const done = task.type === "daily" && data.completedToday.includes(task.id);
            return (
              <button key={task.id} onClick={() => onDirectAward(task)} disabled={done} className="w-full text-left rounded-xl p-2.5 border bg-white border-slate-200 active:bg-emerald-50 active:border-emerald-400 disabled:opacity-50 flex items-center gap-2.5 min-h-[60px]">
                <div className="p-1.5 rounded-lg bg-emerald-50 shrink-0"><Icon size={16} className="text-emerald-700" /></div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-800 text-sm leading-tight">{task.name}</p>
                  <p className="text-[11px] text-slate-500">{done ? "Awarded today ✓" : `Tap to award`}</p>
                </div>
                <span className="text-emerald-700 font-bold text-sm shrink-0">+{task.points}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl p-3">
        <h3 className="font-semibold text-slate-800 text-sm mb-1 flex items-center gap-2"><Plus size={16} className="text-emerald-600" /> Custom bonus</h3>
        <p className="text-[11px] text-slate-500 mb-2">One-off rewards.</p>
        <div className="grid grid-cols-3 gap-2">
          <input type="number" value={customAmount} onChange={(e) => setCustomAmount(e.target.value)} placeholder="Pts" className="col-span-1 px-2 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          <input value={customReason} onChange={(e) => setCustomReason(e.target.value)} placeholder="Reason (optional)" className="col-span-2 px-2 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
        </div>
        <button onClick={handleAward} className="w-full mt-2 bg-emerald-600 active:bg-emerald-700 text-white font-semibold py-2.5 rounded-lg text-sm">Award</button>
      </section>

      <section className="bg-white border border-rose-200 rounded-2xl p-3">
        <h3 className="font-semibold text-slate-800 text-sm mb-1 flex items-center gap-2"><Frown size={16} className="text-rose-600" /> Quick deductions</h3>
        <p className="text-[11px] text-slate-500 mb-2">Tap to apply. Bike moves further away.</p>
        <div className="space-y-2">
          {(data.deductions || []).map(d => {
            const Icon = ICON_MAP[d.icon] || Frown;
            return (
              <button key={d.id} onClick={() => onDeduct(d.points, d.name)} className="w-full text-left rounded-xl p-2.5 border bg-white border-rose-200 active:bg-rose-50 flex items-center gap-2.5 min-h-[60px]">
                <div className="p-1.5 rounded-lg bg-rose-50 shrink-0"><Icon size={16} className="text-rose-700" /></div>
                <div className="flex-1 min-w-0"><p className="font-medium text-slate-800 text-sm leading-tight">{d.name}</p></div>
                <span className="text-rose-700 font-bold text-sm shrink-0">−{d.points}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="bg-white border border-rose-200 rounded-2xl p-3">
        <h3 className="font-semibold text-slate-800 text-sm mb-1 flex items-center gap-2"><Minus size={16} className="text-rose-600" /> Custom deduction</h3>
        <p className="text-[11px] text-slate-500 mb-2">One-off, not in the list.</p>
        <div className="grid grid-cols-3 gap-2">
          <input type="number" value={deductAmount} onChange={(e) => setDeductAmount(e.target.value)} placeholder="Pts" className="col-span-1 px-2 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-500" />
          <input value={deductReason} onChange={(e) => setDeductReason(e.target.value)} placeholder="Reason" className="col-span-2 px-2 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-500" />
        </div>
        <button onClick={handleDeduct} className="w-full mt-2 bg-rose-600 active:bg-rose-700 text-white font-semibold py-2.5 rounded-lg text-sm">Deduct</button>
      </section>
    </div>
  );
}

function ManageTasksTab({ data, setData, showToast }) {
  const [editing, setEditing] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const blank = { id: "", name: "", points: 10, type: "daily", icon: "Sparkles", parentOnly: false };
  const [draft, setDraft] = useState(blank);

  const startAdd = () => { setDraft({ ...blank, id: uid() }); setEditing(null); setShowAdd(true); };
  const startEdit = (task) => { setDraft({ ...task }); setEditing(task.id); setShowAdd(true); };

  const saveTask = () => {
    if (!draft.name.trim()) { showToast("Name required", "warn"); return; }
    if (editing) setData({ ...data, tasks: data.tasks.map(t => t.id === editing ? draft : t) });
    else setData({ ...data, tasks: [...data.tasks, draft] });
    setShowAdd(false); setEditing(null);
    showToast("Task saved", "success");
  };

  const deleteTask = (id) => {
    if (!confirm("Delete this task?")) return;
    setData({ ...data, tasks: data.tasks.filter(t => t.id !== id) });
    showToast("Task deleted", "warn");
  };

  return (
    <div className="space-y-2">
      <button onClick={startAdd} className="w-full bg-teal-700 active:bg-teal-800 text-white font-semibold py-2.5 rounded-xl flex items-center justify-center gap-2 text-sm">
        <Plus size={16} /> Add new task
      </button>

      {showAdd && (
        <div className="bg-white border-2 border-teal-300 rounded-2xl p-3 space-y-2.5">
          <h3 className="font-semibold text-slate-800 text-sm">{editing ? "Edit task" : "New task"}</h3>
          <div>
            <label className="text-[11px] text-slate-500 block mb-1">Task name</label>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm" placeholder="e.g. Ate vegetables" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-slate-500 block mb-1">Points</label>
              <input type="number" value={draft.points} onChange={(e) => setDraft({ ...draft, points: parseInt(e.target.value) || 0 })} className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="text-[11px] text-slate-500 block mb-1">Frequency</label>
              <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm">
                <option value="daily">Once per day</option>
                <option value="repeatable">Can repeat</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-[11px] text-slate-500 block mb-1">Icon</label>
            <select value={draft.icon} onChange={(e) => setDraft({ ...draft, icon: e.target.value })} className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm">
              {Object.keys(ICON_MAP).map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={draft.parentOnly} onChange={(e) => setDraft({ ...draft, parentOnly: e.target.checked })} className="rounded" />
            Parent-only (only you can award)
          </label>
          <div className="flex gap-2">
            <button onClick={saveTask} className="flex-1 bg-teal-700 active:bg-teal-800 text-white font-semibold py-2 rounded-lg text-sm">Save</button>
            <button onClick={() => { setShowAdd(false); setEditing(null); }} className="flex-1 bg-white border border-slate-300 text-slate-700 font-medium py-2 rounded-lg text-sm">Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {data.tasks.map(task => {
          const Icon = ICON_MAP[task.icon] || Sparkles;
          return (
            <div key={task.id} className="bg-white border border-slate-200 rounded-xl p-2.5 flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-slate-100 shrink-0"><Icon size={16} className="text-slate-600" /></div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-800 text-sm truncate">{task.name}</p>
                <p className="text-[11px] text-slate-500">{task.points} pts · {task.type === "daily" ? "Daily" : "Repeats"} {task.parentOnly && "· Parent only"}</p>
              </div>
              <button onClick={() => startEdit(task)} className="p-2 text-slate-500 active:text-teal-700"><Edit3 size={16} /></button>
              <button onClick={() => deleteTask(task.id)} className="p-2 text-slate-500 active:text-rose-600"><Trash2 size={16} /></button>
            </div>
          );
        })}
      </div>

      <DeductionsManager data={data} setData={setData} showToast={showToast} />
    </div>
  );
}

function DeductionsManager({ data, setData, showToast }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const blank = { id: "", name: "", points: 20, icon: "Frown" };
  const [draft, setDraft] = useState(blank);

  const startAdd = () => { setDraft({ ...blank, id: uid() }); setEditing(null); setShowAdd(true); };
  const startEdit = (d) => { setDraft({ ...d }); setEditing(d.id); setShowAdd(true); };

  const saveItem = () => {
    if (!draft.name.trim()) { showToast("Name required", "warn"); return; }
    const list = data.deductions || [];
    if (editing) setData({ ...data, deductions: list.map(x => x.id === editing ? draft : x) });
    else setData({ ...data, deductions: [...list, draft] });
    setShowAdd(false); setEditing(null);
    showToast("Deduction saved", "success");
  };

  const deleteItem = (id) => {
    if (!confirm("Delete this deduction?")) return;
    setData({ ...data, deductions: (data.deductions || []).filter(x => x.id !== id) });
    showToast("Deduction deleted", "warn");
  };

  return (
    <div className="space-y-2 mt-5 pt-4 border-t border-slate-200">
      <h3 className="text-[11px] font-bold text-rose-600 uppercase tracking-wider px-1 mb-1">Deductions</h3>
      <button onClick={startAdd} className="w-full bg-rose-600 active:bg-rose-700 text-white font-semibold py-2.5 rounded-xl flex items-center justify-center gap-2 text-sm">
        <Plus size={16} /> Add new deduction
      </button>
      {showAdd && (
        <div className="bg-white border-2 border-rose-300 rounded-2xl p-3 space-y-2.5">
          <h3 className="font-semibold text-slate-800 text-sm">{editing ? "Edit deduction" : "New deduction"}</h3>
          <div>
            <label className="text-[11px] text-slate-500 block mb-1">Name</label>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm" placeholder="e.g. Yelling" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-slate-500 block mb-1">Points to lose</label>
              <input type="number" value={draft.points} onChange={(e) => setDraft({ ...draft, points: parseInt(e.target.value) || 0 })} className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="text-[11px] text-slate-500 block mb-1">Icon</label>
              <select value={draft.icon} onChange={(e) => setDraft({ ...draft, icon: e.target.value })} className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm">
                {Object.keys(ICON_MAP).map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={saveItem} className="flex-1 bg-rose-600 active:bg-rose-700 text-white font-semibold py-2 rounded-lg text-sm">Save</button>
            <button onClick={() => { setShowAdd(false); setEditing(null); }} className="flex-1 bg-white border border-slate-300 text-slate-700 font-medium py-2 rounded-lg text-sm">Cancel</button>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {(data.deductions || []).map(d => {
          const Icon = ICON_MAP[d.icon] || Frown;
          return (
            <div key={d.id} className="bg-white border border-rose-200 rounded-xl p-2.5 flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-rose-50 shrink-0"><Icon size={16} className="text-rose-700" /></div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-800 text-sm truncate">{d.name}</p>
                <p className="text-[11px] text-rose-700">−{d.points} pts</p>
              </div>
              <button onClick={() => startEdit(d)} className="p-2 text-slate-500 active:text-teal-700"><Edit3 size={16} /></button>
              <button onClick={() => deleteItem(d.id)} className="p-2 text-slate-500 active:text-rose-600"><Trash2 size={16} /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HistoryTab({ data }) {
  if (data.history.length === 0) {
    return <div className="bg-white rounded-2xl p-6 text-center border border-slate-200"><History size={32} className="text-slate-300 mx-auto mb-2" /><p className="text-slate-500 text-sm">No activity yet</p></div>;
  }
  return (
    <div className="space-y-2">
      {data.history.slice(0, 100).map(h => (
        <div key={h.id} className="bg-white border border-slate-200 rounded-xl p-2.5 flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-slate-800 text-sm truncate">{h.taskName}</p>
            <p className="text-[11px] text-slate-500">{formatTime(h.at)}</p>
          </div>
          <span className={`font-bold text-sm shrink-0 ml-2 ${h.type === "earned" ? "text-emerald-600" : h.type === "deducted" ? "text-rose-600" : "text-slate-500"}`}>{h.points > 0 ? `+${h.points}` : h.points}</span>
        </div>
      ))}
    </div>
  );
}

function ChildSettingsTab({ child, data, setData, updateChildMeta, deleteChild, showToast }) {
  const [displayName, setDisplayName] = useState(child.displayName);
  const [username, setUsername] = useState(child.username);
  const [newPassword, setNewPassword] = useState("");
  const [gName, setGName] = useState(data.goal.name);
  const [gImage, setGImage] = useState(data.goal.imageUrl);
  const [gThreshold, setGThreshold] = useState(data.goal.thresholdPct);
  const [gEndDate, setGEndDate] = useState(data.goal.endDate);
  const [gProgress, setGProgress] = useState(data.goal.earnedPoints || 0);
  const [busy, setBusy] = useState(false);

  const saveAccount = async () => {
    setBusy(true);
    try {
      const u = username.trim().toLowerCase();
      if (!displayName.trim() || !u) { showToast("Display name and username required", "warn"); return; }
      const updates = { displayName: displayName.trim(), username: u };
      if (newPassword) updates.passwordHash = await hashPassword(newPassword);
      updateChildMeta(updates);
      setNewPassword("");
      showToast("Account updated", "success");
    } finally { setBusy(false); }
  };

  const saveGoal = () => {
    setData({
      ...data,
      goal: {
        ...data.goal,
        name: gName || "Christmas Goal",
        imageUrl: gImage || DEFAULT_BIKE_IMAGE,
        thresholdPct: Math.max(1, Math.min(100, parseInt(gThreshold) || 60)),
        endDate: gEndDate || defaultChristmasEndDate(),
      },
    });
    showToast("Goal updated", "success");
  };

  const setScore = () => {
    setData({ ...data, goal: { ...data.goal, earnedPoints: Math.max(0, parseInt(gProgress) || 0) }});
    showToast("Score updated", "success");
  };

  const confirmDelete = () => {
    if (!confirm(`Delete ${child.displayName} and all their data? Cannot be undone.`)) return;
    if (!confirm("Really sure?")) return;
    deleteChild();
  };

  return (
    <div className="space-y-3">
      <section className="bg-white border border-slate-200 rounded-2xl p-3 space-y-2.5">
        <h3 className="font-semibold text-slate-800 text-sm flex items-center gap-2"><User size={16} /> Account</h3>
        <div>
          <label className="text-[11px] text-slate-500 block mb-1">Display name</label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="text-[11px] text-slate-500 block mb-1">Username</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="text-[11px] text-slate-500 block mb-1">New password (blank = keep current)</label>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm" placeholder="••••••••" />
        </div>
        <button onClick={saveAccount} disabled={busy} className="w-full bg-teal-700 active:bg-teal-800 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm">Save account</button>
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl p-3 space-y-2.5">
        <h3 className="font-semibold text-slate-800 text-sm flex items-center gap-2"><Gift size={16} /> Christmas goal</h3>
        <div>
          <label className="text-[11px] text-slate-500 block mb-1">Goal name</label>
          <input value={gName} onChange={(e) => setGName(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="text-[11px] text-slate-500 block mb-1">Image URL (or blank for default)</label>
          <input value={gImage.startsWith("data:") ? "" : gImage} onChange={(e) => setGImage(e.target.value)} placeholder="https://..." className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm" />
          {gImage && <img src={gImage} alt="preview" className="mt-2 w-full max-h-28 object-contain bg-slate-50 rounded-lg border border-slate-200" />}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] text-slate-500 block mb-1">Threshold %</label>
            <input type="number" min="1" max="100" value={gThreshold} onChange={(e) => setGThreshold(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="text-[11px] text-slate-500 block mb-1">End date</label>
            <input type="date" value={gEndDate} onChange={(e) => setGEndDate(e.target.value)} className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm" />
          </div>
        </div>
        <button onClick={saveGoal} className="w-full bg-teal-700 active:bg-teal-800 text-white font-semibold py-2.5 rounded-lg text-sm">Save goal</button>
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
          <label className="text-[11px] text-slate-500 block mb-1">Current score (manual override)</label>
          <div className="flex gap-2">
            <input type="number" value={gProgress} onChange={(e) => setGProgress(parseInt(e.target.value) || 0)} className="flex-1 px-2.5 py-2 border border-slate-300 rounded-lg text-sm bg-white" />
            <button onClick={setScore} className="px-3 bg-slate-700 active:bg-slate-800 text-white rounded-lg text-sm font-medium">Set</button>
          </div>
        </div>
      </section>

      <section className="bg-rose-50 border border-rose-200 rounded-2xl p-3">
        <h3 className="font-semibold text-rose-900 text-sm mb-1 flex items-center gap-2"><AlertCircle size={16} /> Danger zone</h3>
        <p className="text-[11px] text-rose-700 mb-2">Permanently delete this child and all their data.</p>
        <button onClick={confirmDelete} className="w-full bg-white border border-rose-300 text-rose-700 active:bg-rose-100 font-semibold py-2 rounded-lg text-sm">Delete {child.displayName}</button>
      </section>
    </div>
  );
}