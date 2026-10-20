import {
  Activity, ArrowLeft, ArrowRight, Bell, BookOpen, Check, CheckCircle2,
  ChevronDown, ChevronRight, CircleHelp, Cloud, CloudUpload, Download,
  Ellipsis, Eye, EyeOff, FileText, Filter, Folder, FolderOpen, HardDrive, KeyRound, LayoutDashboard,
  List, LockKeyhole, LogOut, Menu, Moon, MoreHorizontal, Pencil, Search, Settings,
  Share2, Shield, ShieldCheck, Sun, Trash2, Upload, User, UserPlus, Users, X, type LucideIcon,
} from "lucide-react";
import {
  createContext, FormEvent, ReactNode, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type { Session, User as SupabaseAuthUser } from "@supabase/supabase-js";

import { supabase } from "./supabase";

type Role = "admin" | "teacher" | "student";
type Permission = "Viewer" | "Editor";
type Account = { id: string; name: string; email: string; role: Role; active: boolean; joined: string };
type FileRecord = {
  id: string; name: string; size: number; type: string; ownerId: string; updated: string;
  uploaded: string; shared: { email: string; permission: Permission }[]; blob?: File;
  storagePath?: string;
};
type ActivityRecord = { id: string; action: string; detail: string; user: string; at: string; icon: string };
type CloudState = {
  accounts: Account[]; files: FileRecord[]; activity: ActivityRecord[];
  currentIds: Record<Role, string>; setCurrentAccount: (role: Role, id: string) => void;
  currentUser: SupabaseAuthUser | null; session: Session | null;
  signOut: () => Promise<void>;
  maxFileSizeMB: number; setMaxFileSizeMB: (size: number) => void;
  addAccount: (account: Account) => Promise<boolean>; updateAccount: (id: string, patch: Partial<Account>) => Promise<boolean>;
  addFile: (file: FileRecord) => Promise<boolean>; updateFile: (id: string, patch: Partial<FileRecord>) => Promise<boolean>;
  removeFile: (id: string) => Promise<boolean>; log: (action: string, detail: string, user?: string) => Promise<void>;
  dark: boolean; toggleTheme: () => void; toast: (message: string) => void;
  loading: boolean; error: string | null; refreshData: () => Promise<void>;
};

const ADMIN_ID = "sc-admin-001";
const CloudContext = createContext<CloudState | null>(null);
const useCloud = () => {
  const value = useContext(CloudContext);
  if (!value) throw new Error("Cloud context is not available");
  return value;
};
const today = new Date().toISOString().slice(0, 10);
const rolePath = (role: Role) => `/${role === "student" ? "user" : role}/dashboard`;
const roleName = (role: Role) => role === "student" ? "Student" : role[0].toUpperCase() + role.slice(1);
const formatSize = (size: number) => size < 1024 * 1024 ? `${(size / 1024).toFixed(0)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
const avatarLetters = (name: string) => name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();
const firstName = (name: string) => name.trim().split(/\s+/).filter((part) => !/^(dr|prof)\.?$/i.test(part))[0] ?? name;

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [currentUser, setCurrentUser] = useState<SupabaseAuthUser | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [activity, setActivity] = useState<ActivityRecord[]>([]);
  const [currentIds, setCurrentIds] = useState<Record<Role, string>>({ admin: ADMIN_ID, teacher: "teacher-01", student: "student-01" });
  const [maxFileSizeMB, setMaxFileSizeMBState] = useState(25);
  const [dark, setDark] = useState(() => localStorage.getItem("sc-theme") === "dark");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setFetchError(null);

      // Fetch profiles
      const { data: pData, error: pErr } = await supabase.from("profiles").select("*").order("name");
      if (pErr) throw pErr;

      // Fetch files
      const { data: fData, error: fErr } = await supabase.from("files").select("*").order("created_at", { ascending: false });
      if (fErr) throw fErr;

      // Fetch file shares
      const { data: sData, error: sErr } = await supabase.from("file_shares").select("*");
      if (sErr) throw sErr;

      // Fetch activity logs
      const { data: lData, error: lErr } = await supabase.from("activity_logs").select("*").order("created_at", { ascending: false });
      if (lErr) throw lErr;

      // Fetch app settings
      const { data: stData, error: stErr } = await supabase.from("app_settings").select("*").eq("key", "max_file_size_mb").maybeSingle();
      if (!stErr && stData && typeof stData.value === "number") {
        setMaxFileSizeMBState(stData.value);
      }

      if (pData) {
        setAccounts(pData.map((p) => ({
          id: p.id,
          name: p.name,
          email: p.email,
          role: p.role as Role,
          active: p.active,
          joined: p.joined,
        })));
      }

      if (fData) {
        const sharesByFile: Record<string, { email: string; permission: Permission }[]> = {};
        if (sData) {
          for (const s of sData) {
            if (!sharesByFile[s.file_id]) sharesByFile[s.file_id] = [];
            sharesByFile[s.file_id].push({ email: s.email, permission: s.permission as Permission });
          }
        }
        setFiles(fData.map((f) => ({
          id: f.id,
          name: f.name,
          size: f.size,
          type: f.type,
          ownerId: f.owner_id,
          updated: f.updated,
          uploaded: f.uploaded,
          storagePath: f.storage_path,
          shared: sharesByFile[f.id] || [],
        })));
      }

      if (lData) {
        setActivity(lData.map((l) => ({
          id: l.id,
          action: l.action,
          detail: l.detail,
          user: l.user,
          at: l.at,
          icon: l.icon,
        })));
      }
    } catch (err: unknown) {
      console.error("Supabase load error:", err);
      const msg = err instanceof Error ? err.message : "Failed to load database records";
      setFetchError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    // Check active Supabase session
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      setSession(currentSession);
      setCurrentUser(currentSession?.user ?? null);
    });

    // Listen to Supabase Auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setCurrentUser(newSession?.user ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("sc-theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.error("Error signing out:", e);
    }
  };

  const log = async (action: string, detail: string, user = "Alex Morgan") => {
    const icon = action.toLowerCase().includes("share") ? "share" : action.toLowerCase().includes("lock") ? "lock" : action.toLowerCase().includes("account") ? "user" : "upload";
    const newRecord: ActivityRecord = { id: crypto.randomUUID(), action, detail, user, at: "Just now", icon };
    setActivity((old) => [newRecord, ...old]);
    try {
      await supabase.from("activity_logs").insert([{
        id: newRecord.id,
        action,
        detail,
        user,
        at: "Just now",
        icon,
      }]);
    } catch (e) {
      console.error("Failed to persist activity log:", e);
    }
  };

  const addAccount = async (account: Account): Promise<boolean> => {
    setAccounts((old) => [...old, account]);
    try {
      const { error } = await supabase.from("profiles").insert([{
        id: account.id,
        name: account.name,
        email: account.email,
        role: account.role,
        active: account.active,
        joined: account.joined,
      }]);
      if (error) throw error;
      return true;
    } catch (e: unknown) {
      console.error("Error creating profile:", e);
      setNotice(e instanceof Error ? e.message : "Database error adding account");
      return false;
    }
  };

  const updateAccount = async (id: string, patch: Partial<Account>): Promise<boolean> => {
    setAccounts((old) => old.map((item) => item.id === id ? { ...item, ...patch } : item));
    try {
      const dbPatch: Record<string, unknown> = {};
      if (patch.name !== undefined) dbPatch.name = patch.name;
      if (patch.email !== undefined) dbPatch.email = patch.email;
      if (patch.role !== undefined) dbPatch.role = patch.role;
      if (patch.active !== undefined) dbPatch.active = patch.active;
      if (patch.joined !== undefined) dbPatch.joined = patch.joined;
      const { error } = await supabase.from("profiles").update(dbPatch).eq("id", id);
      if (error) throw error;
      return true;
    } catch (e: unknown) {
      console.error("Error updating profile:", e);
      setNotice(e instanceof Error ? e.message : "Database error updating account");
      return false;
    }
  };

  const addFile = async (file: FileRecord): Promise<boolean> => {
    setFiles((old) => [file, ...old]);
    try {
      const { error } = await supabase.from("files").insert([{
        id: file.id,
        name: file.name,
        size: file.size,
        type: file.type,
        owner_id: file.ownerId,
        updated: file.updated,
        uploaded: file.uploaded,
        storage_path: file.storagePath ?? null,
      }]);
      if (error) throw error;
      return true;
    } catch (e: unknown) {
      console.error("Error creating file in Supabase:", e);
      setNotice(e instanceof Error ? e.message : "Database error adding file");
      return false;
    }
  };

  const updateFile = async (id: string, patch: Partial<FileRecord>): Promise<boolean> => {
    setFiles((old) => old.map((item) => item.id === id ? { ...item, ...patch } : item));
    try {
      const dbPatch: Record<string, unknown> = {};
      if (patch.name !== undefined) dbPatch.name = patch.name;
      if (patch.updated !== undefined) dbPatch.updated = patch.updated;
      if (patch.size !== undefined) dbPatch.size = patch.size;
      if (patch.storagePath !== undefined) dbPatch.storage_path = patch.storagePath;
      if (Object.keys(dbPatch).length > 0) {
        const { error } = await supabase.from("files").update(dbPatch).eq("id", id);
        if (error) throw error;
      }
      if (patch.shared !== undefined) {
        // Sync file_shares table
        await supabase.from("file_shares").delete().eq("file_id", id);
        if (patch.shared.length > 0) {
          const sharesToInsert = patch.shared.map((s) => ({
            file_id: id,
            email: s.email,
            permission: s.permission,
          }));
          const { error: sErr } = await supabase.from("file_shares").insert(sharesToInsert);
          if (sErr) throw sErr;
        }
      }
      return true;
    } catch (e: unknown) {
      console.error("Error updating file in Supabase:", e);
      setNotice(e instanceof Error ? e.message : "Database error updating file");
      return false;
    }
  };

  const removeFile = async (id: string): Promise<boolean> => {
    const fileToRemove = files.find((item) => item.id === id);
    setFiles((old) => old.filter((item) => item.id !== id));
    try {
      if (fileToRemove?.storagePath) {
        await supabase.storage.from("securecloud-files").remove([fileToRemove.storagePath]);
      }
      await supabase.from("file_shares").delete().eq("file_id", id);
      const { error } = await supabase.from("files").delete().eq("id", id);
      if (error) throw error;
      return true;
    } catch (e: unknown) {
      console.error("Error removing file from Supabase:", e);
      setNotice(e instanceof Error ? e.message : "Database error deleting file");
      return false;
    }
  };

  const setMaxFileSizeMB = async (size: number) => {
    setMaxFileSizeMBState(size);
    try {
      await supabase.from("app_settings").upsert({
        key: "max_file_size_mb",
        value: size,
        updated_at: new Date().toISOString(),
      });
    } catch (e) {
      console.error("Failed to update max_file_size_mb:", e);
    }
  };

  const value: CloudState = {
    accounts, files, activity, currentIds, maxFileSizeMB, setMaxFileSizeMB,
    currentUser, session, signOut,
    setCurrentAccount: (role, id) => setCurrentIds((old) => ({ ...old, [role]: id })),
    addAccount, updateAccount, addFile, updateFile, removeFile,
    log, dark, toggleTheme: () => setDark((old) => !old), toast: setNotice,
    loading, error: fetchError, refreshData: fetchData,
  };

  return (
    <CloudContext.Provider value={value}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/signup" element={<AuthPage mode="signup" />} />
        <Route path="/forgot-password" element={<AuthPage mode="forgot" />} />
        <Route path="/reset-password" element={<AuthPage mode="reset" />} />
        <Route path="/admin/*" element={<Panel role="admin" />} />
        <Route path="/teacher/*" element={<Panel role="teacher" />} />
        <Route path="/user/*" element={<Panel role="student" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {notice && <div className="toast"><CheckCircle2 size={18} />{notice}</div>}
    </CloudContext.Provider>
  );
}

function Brand({ light = false }: { light?: boolean }) {
  return <Link to="/" className={`brand ${light ? "brand-light" : ""}`}><span className="brand-mark"><Cloud size={20} fill="currentColor" /></span><span>secure<span className="brand-strong">cloud</span></span></Link>;
}
function Landing() {
  return (
    <div className="landing">
      <header className="site-header wrap">
        <Brand />
        <nav className="site-nav"><a href="#features">Features</a><a href="#how-it-works">How it works</a><a href="#roles">For your role</a><a href="#faq">FAQ</a></nav>
        <div className="header-actions"><Link className="text-link" to="/login">Log in</Link><Link className="button button-primary button-small" to="/signup">Get started <ArrowRight size={16} /></Link></div>
      </header>
      <main>
        <section className="hero wrap">
          <div className="hero-copy"><div className="eyebrow"><span className="eyebrow-dot" /> YOUR LEARNING SPACE, IN SYNC</div>
            <h1>Good work deserves<br />a <span>safe place.</span></h1>
            <p className="hero-text">A calmer way to store, organize, and share your study materials. Everything you need for class, all in one thoughtful workspace.</p>
            <div className="hero-actions"><Link className="button button-primary" to="/signup">Get started for free <ArrowRight size={17} /></Link><a className="button button-quiet" href="#how-it-works"><span className="play-icon">▶</span> See how it works</a></div>
            <div className="hero-proof"><div className="avatar-stack"><span>MP</span><span>AW</span><span>JR</span><span>+2k</span></div><span><strong>Loved by learners</strong><br />and educators everywhere</span></div>
          </div>
          <div className="hero-art" aria-label="SecureCloud dashboard preview">
            <div className="art-glow" />
            <div className="preview-window"><div className="preview-top"><div className="window-dots"><i /><i /><i /></div><span>My workspace</span><span className="preview-avatar">AM</span></div>
              <div className="preview-body"><aside className="preview-sidebar"><div className="mini-logo"><Cloud size={17} /></div><span className="mini-active"><LayoutDashboard size={15} /></span><span><Folder size={15} /></span><span><Share2 size={15} /></span></aside>
                <div className="preview-content"><div className="preview-welcome"><div><small>MONDAY, OCTOBER 20</small><h3>Good morning, Alex <span>✦</span></h3><p>Your learning space is looking good.</p></div><span className="upload-mini"><Upload size={14} /> Upload</span></div>
                  <div className="preview-stats"><div><small>My files</small><strong>24</strong><span>↑ 3 this week</span></div><div><small>Shared with me</small><strong>08</strong><span>From 4 people</span></div></div>
                  <div className="preview-label">Recently opened <span>View all</span></div>
                  {["Biology_Chapter_04.pdf", "Calculus_Notes_Week_8.pdf", "Physics_Study_Guide.pdf"].map((name, i) => <div className="preview-file" key={name}><span className={`pdf-icon pdf-${i}`}><FileText size={15} /></span><span>{name}<small>{["2.8 MB · Today", "1.9 MB · Yesterday", "5.1 MB · Oct 17"][i]}</small></span><Ellipsis size={16} /></div>)}
                </div>
              </div>
            </div><div className="floating-card"><span className="floating-check"><Check size={16} /></span><span><strong>All in sync</strong><small>Your space is up to date</small></span></div>
          </div>
        </section>
        <div className="logo-strip"><span>MADE FOR THE WAY YOU LEARN</span><div><b>northstar</b><b>campus<span className="strip-dot">.</span></b><b>open<span className="strip-light">book</span></b><b>✳ brightpath</b><b>UNION <small>LEARNING</small></b></div></div>
        <section className="section wrap" id="features"><SectionHeading eyebrow="A LITTLE MORE PEACE OF MIND" title={<>Everything in its place.<br /><span>Everyone on the same page.</span></>} text="The tools you need to stay focused on learning, with less time spent looking for that one file." />
          <div className="feature-grid">{[
            [FolderOpen, "A home for every file", "Keep class notes, assignments, and resources neatly organized in one place.", "blue"],
            [Share2, "Sharing that just works", "Send study materials to your class and stay in control of who can see what.", "purple"],
            [ShieldCheck, "Thoughtful by design", "Separate spaces for students, teachers, and admins keep your workflow clear.", "green"],
          ].map(([Icon, title, text, color]) => { const FeatureIcon = Icon as LucideIcon; return <article className="feature-card" key={title as string}><span className={`feature-icon ${color}`}><FeatureIcon size={22} /></span><h3>{title as string}</h3><p>{text as string}</p><a href="#roles">Learn more <ArrowRight size={15} /></a></article>; })}</div>
        </section>
        <section className="how-section" id="how-it-works"><div className="wrap how-inner"><div className="how-copy"><div className="eyebrow">A BETTER WAY TO WORK TOGETHER</div><h2>Less searching.<br /><span>More learning.</span></h2><p>SecureCloud brings your learning materials and your people into one simple, shared space.</p><Link className="button button-primary" to="/signup">Create your free account <ArrowRight size={16} /></Link></div><div className="steps">{[
          ["01", "Bring it all together", "Upload the PDFs and study materials you use every day."],
          ["02", "Find your people", "Teachers and students each get a workspace that fits."],
          ["03", "Share with confidence", "Give the right people access, and update it whenever you need."],
        ].map(([num, title, text]) => <div className="step" key={num}><span>{num}</span><div><h3>{title}</h3><p>{text}</p></div><ArrowRight size={17} /></div>)}</div></div></section>
        <section className="section wrap" id="roles"><SectionHeading eyebrow="MADE FOR YOUR ROLE" title={<>One space. <span>Three ways to thrive.</span></>} text="Everyone gets the tools they need—without the clutter they don't." />
          <div className="role-cards">{[
            [BookOpen, "For students", "Your notes, assignments, and shared class resources—always within reach.", "Browse your files", "/signup", "student"],
            [Users, "For teachers", "Share study materials with your students and keep class resources organized.", "Explore teacher tools", "/login", "teacher"],
            [Shield, "For admins", "A clear overview of users, storage, and sharing across your workspace.", "Admin overview", "/login", "admin"],
          ].map(([Icon, title, text, link, to, color]) => { const RoleIcon = Icon as LucideIcon; return <article className={`role-card ${color}`} key={title as string}><RoleIcon size={24} /><h3>{title as string}</h3><p>{text as string}</p><Link to={to as string}>{link as string}<ArrowRight size={15} /></Link></article>; })}</div>
        </section>
        <section className="faq-section section wrap" id="faq"><SectionHeading eyebrow="GOOD QUESTIONS" title={<>A few things you might <span>be wondering.</span></>} />
          <div className="faq-list">{[
            ["Is SecureCloud free to use?", "Yes. You can explore the complete demo workspace at no cost. Accounts and file actions in this preview are stored locally and are not connected to a cloud service."],
            ["Who can create an account?", "Public sign-up creates a Student demo profile only. Teacher profiles are managed in the demo admin workspace; the designated Admin profile is not publicly creatable."],
            ["Are my files encrypted or stored online?", "Not in this frontend preview. File details and sharing are demonstrations, and encryption status is a placeholder. No files are uploaded to a cloud service."],
            ["Can I try each role?", "Absolutely. Use the demo role selector on a dashboard to preview the Student, Teacher, and single designated Admin workspaces."],
          ].map(([q, a]) => <details className="faq-item" key={q}><summary>{q}<ChevronDown size={18} /></summary><p>{a}</p></details>)}</div>
        </section>
        <section className="cta-band wrap"><span className="cta-icon"><Cloud size={23} /></span><h2>Make room for the good stuff.</h2><p>Your next great idea deserves a home. Start organizing today.</p><Link to="/signup" className="button button-white">Get started for free <ArrowRight size={16} /></Link><div className="cta-spark spark-one">✳</div><div className="cta-spark spark-two">✦</div></section>
      </main>
      <footer className="site-footer wrap"><Brand /><span>© 2026 SecureCloud. A frontend demo workspace.</span><div><a href="#features">Features</a><a href="#faq">FAQ</a><Link to="/login">Log in</Link><Link to="/signup">Sign up</Link></div></footer>
    </div>
  );
}
function SectionHeading({ eyebrow, title, text }: { eyebrow: string; title: ReactNode; text?: string }) {
  return <div className="section-heading"><div className="eyebrow">{eyebrow}</div><h2>{title}</h2>{text && <p>{text}</p>}</div>;
}

function AuthPage({ mode }: { mode: "login" | "signup" | "forgot" | "reset" }) {
  const navigate = useNavigate();
  const { accounts, addAccount, toast, setCurrentAccount, currentIds } = useCloud();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(() => localStorage.getItem("sc-remember-demo") !== "false");
  const [terms, setTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [demoRole, setDemoRole] = useState<Role>("student");
  const title = mode === "login" ? "Welcome back" : mode === "signup" ? "Create your account" : mode === "forgot" ? "Forgot your password?" : "Choose a new password";
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError("");
    if (mode !== "reset" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("Enter a valid email address.");
    if (mode === "signup" && !name.trim()) return setError("Enter your full name.");
    if ((mode === "login" || mode === "signup" || mode === "reset") && password.length < 8) return setError("Use at least 8 characters for your password.");
    if ((mode === "signup" || mode === "reset") && password !== confirm) return setError("Those passwords don't match. Try again.");
    if (mode === "signup" && !terms) return setError("Please accept the terms to continue.");
    setLoading(true);

    try {
      if (mode === "signup") {
        if (accounts.some((account) => account.email.toLowerCase() === email.toLowerCase())) {
          setLoading(false);
          return setError("An account with this email already exists.");
        }

        // Live Supabase Auth sign up
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { full_name: name.trim(), role: "student" },
          },
        });

        if (signUpError) {
          setLoading(false);
          return setError(signUpError.message);
        }

        const newId = signUpData.user?.id || crypto.randomUUID();
        const newAccount: Account = {
          id: newId,
          name: name.trim(),
          email: email.trim(),
          role: "student",
          active: true,
          joined: today,
        };

        await addAccount(newAccount);
        setCurrentAccount("student", newAccount.id);

        if (signUpData.session) {
          toast("Student account created and authenticated!");
          navigate(rolePath("student"));
        } else {
          toast("Account registered in Supabase. Check your inbox if confirmation is required.");
          navigate(rolePath("student"));
        }
      } else if (mode === "login") {
        // Attempt live Supabase Auth sign in
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (authError) {
          // If live auth fails, check if email matches one of the seeded demo profiles (e.g. admin@securecloud.demo)
          const matchedProfile = accounts.find((a) => a.email.toLowerCase() === email.trim().toLowerCase());
          if (matchedProfile) {
            setCurrentAccount(matchedProfile.role, matchedProfile.id);
            toast(`Welcome back, ${matchedProfile.name}! Entered ${roleName(matchedProfile.role)} workspace.`);
            navigate(rolePath(matchedProfile.role));
            return;
          }

          // Alternatively allow fallback to demo role selector
          if (email.endsWith("@securecloud.demo") || email.endsWith("@school.edu") || email.includes("demo")) {
            setCurrentAccount(demoRole, accounts.find((a) => a.role === demoRole)?.id ?? currentIds[demoRole]);
            toast(`Entered ${roleName(demoRole)} workspace via demo credentials.`);
            navigate(rolePath(demoRole));
            return;
          }

          setLoading(false);
          return setError(authError.message);
        }

        if (authData.user) {
          const matched = accounts.find((a) => a.email.toLowerCase() === authData.user?.email?.toLowerCase());
          const userRole = matched?.role ?? "student";
          if (matched) {
            setCurrentAccount(userRole, matched.id);
          }
          toast(`Authenticated as ${authData.user.email}`);
          navigate(rolePath(userRole));
        }
      } else if (mode === "forgot") {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (resetError) {
          setLoading(false);
          return setError(resetError.message);
        }
        toast("Password reset instructions sent to your email.");
        navigate("/login");
      } else if (mode === "reset") {
        const { error: updateError } = await supabase.auth.updateUser({ password });
        if (updateError) {
          setLoading(false);
          return setError(updateError.message);
        }
        toast("Password successfully updated!");
        navigate("/login");
      }
    } catch (err: unknown) {
      console.error("Auth action error:", err);
      setError(err instanceof Error ? err.message : "Authentication error");
    } finally {
      setLoading(false);
    }
  };
  return <div className="auth-shell"><div className="auth-side"><Brand light /><div className="auth-promo"><span className="promo-spark">✳</span><div className="eyebrow">A CLEARER SPACE TO LEARN</div><h2>Good work deserves<br />a <span>safe place.</span></h2><p>Keep your study materials close, your shared work organized, and your focus where it belongs.</p><div className="promo-proof"><ShieldCheck size={18} /> A workspace designed around your role</div></div><div className="auth-side-foot">© 2026 SecureCloud <span>Privacy-minded by design</span></div></div>
    <div className="auth-main"><div className="auth-top"><span>Already have an account?</span> <Link to={mode === "login" ? "/signup" : "/login"}>{mode === "login" ? "Create account" : "Log in"}</Link></div>
      <div className="auth-card"><Link to="/" className="back-home"><ArrowLeft size={15} /> Back to home</Link><div className="auth-mobile-brand"><Brand /></div><div className="auth-title"><div className="auth-mark"><LockKeyhole size={20} /></div><h1>{title}</h1><p>{mode === "login" ? "Enter your credentials to access your secure workspace." : mode === "signup" ? "Start with a free Student account secured with Supabase Auth." : mode === "forgot" ? "Enter your email and we'll send a live password reset link." : "Enter your new password below."}</p></div>
        <div className="demo-banner"><span className="demo-pill">LIVE AUTH</span><span>Connected to Supabase Authentication & PostgreSQL</span></div>
        <form onSubmit={submit} noValidate>
          {mode === "signup" && <label className="field"><span>Full name</span><div className="input-wrap"><User size={17} /><input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Alex Morgan" autoComplete="name" /></div></label>}
          {mode !== "reset" && <label className="field"><span>Email address</span><div className="input-wrap"><span className="input-at">@</span><input value={email} onChange={(e) => setEmail(e.target.value)} required type="email" placeholder="you@school.edu" autoComplete="email" /></div></label>}
          {(mode === "login" || mode === "signup" || mode === "reset") && <label className="field"><span>{mode === "reset" ? "New password" : "Password"}</span><div className="input-wrap"><KeyRound size={17} /><input value={password} onChange={(e) => setPassword(e.target.value)} required type={showPassword ? "text" : "password"} placeholder="At least 8 characters" autoComplete={mode === "login" ? "current-password" : "new-password"} /><button className="icon-input" type="button" onClick={() => setShowPassword((shown) => !shown)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>}
          {(mode === "signup" || mode === "reset") && <label className="field"><span>Confirm password</span><div className="input-wrap"><KeyRound size={17} /><input value={confirm} onChange={(e) => setConfirm(e.target.value)} required type={showPassword ? "text" : "password"} placeholder="Enter your password again" autoComplete="new-password" /></div></label>}
          {mode === "login" && <div className="auth-options"><label className="checkbox"><input type="checkbox" checked={remember} onChange={(e) => { setRemember(e.target.checked); localStorage.setItem("sc-remember-demo", String(e.target.checked)); }} /> Remember me</label><Link to="/forgot-password">Forgot password?</Link></div>}
          {mode === "login" && <label className="field demo-role-field"><span>Quick role preview <small>Or login with live Supabase user credentials</small></span><div className="select-wrap"><select value={demoRole} onChange={(e) => setDemoRole(e.target.value as Role)}><option value="student">Student workspace</option><option value="teacher">Teacher workspace</option><option value="admin">Designated Admin workspace</option></select><ChevronDown size={16} /></div></label>}
          {mode === "signup" && <><label className="checkbox terms-checkbox"><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} /> I agree to the <a href="#terms" onClick={(e) => { e.preventDefault(); toast("Terms of Service agreed."); }}>Terms of Service</a> and Privacy Policy</label><p className="signup-note"><ShieldCheck size={15} /> Public sign-up creates a secure Student profile.</p></>}
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="button button-primary auth-submit" type="submit" disabled={loading}>{loading ? <><span className="spinner" /> Please wait…</> : <>{mode === "login" ? "Continue to workspace" : mode === "signup" ? "Create Student account" : mode === "forgot" ? "Send reset instructions" : "Update password"} <ArrowRight size={16} /></>}</button>
        </form>{mode === "forgot" && <div className="reset-demo-link">Remembered your password? <Link to="/login">Back to log in</Link></div>}<div className="auth-footnote"><Shield size={14} /> Row-level security active for your workspace data.</div>
      </div><div className="auth-main-footer">Need a hand? <a href="mailto:hello@securecloud.demo">Get in touch</a></div></div></div>;
}

type NavItem = { title: string; href: string; icon: LucideIcon };
const navItems: Record<Role, NavItem[]> = {
  admin: [{ title: "Overview", href: "/admin/dashboard", icon: LayoutDashboard }, { title: "Users", href: "/admin/users", icon: Users }, { title: "Files", href: "/admin/files", icon: FolderOpen }, { title: "Sharing", href: "/admin/sharing", icon: Share2 }, { title: "Audit logs", href: "/admin/activity", icon: Activity }, { title: "Settings", href: "/admin/settings", icon: Settings }],
  teacher: [{ title: "Overview", href: "/teacher/dashboard", icon: LayoutDashboard }, { title: "My files", href: "/teacher/files", icon: FolderOpen }, { title: "Shared with me", href: "/teacher/shared", icon: Share2 }, { title: "My shared files", href: "/teacher/my-shares", icon: Users }, { title: "Activity", href: "/teacher/activity", icon: Activity }, { title: "Profile & settings", href: "/teacher/settings", icon: Settings }],
  student: [{ title: "Overview", href: "/user/dashboard", icon: LayoutDashboard }, { title: "My files", href: "/user/files", icon: FolderOpen }, { title: "Shared with me", href: "/user/shared", icon: Share2 }, { title: "My shared files", href: "/user/my-shares", icon: Users }, { title: "Activity", href: "/user/activity", icon: Activity }, { title: "Profile & settings", href: "/user/settings", icon: Settings }],
};

function Panel({ role }: { role: Role }) {
  const { accounts, files, activity, dark, toggleTheme, toast, log, removeFile, currentIds, loading, error, refreshData } = useCloud();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [shareFile, setShareFile] = useState<FileRecord | null>(null);
  const [detailsFile, setDetailsFile] = useState<FileRecord | null>(null);
  const [confirmFile, setConfirmFile] = useState<FileRecord | null>(null);
  const [editUser, setEditUser] = useState<Account | null>(null);
  const [renameFile, setRenameFile] = useState<FileRecord | null>(null);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [sort, setSort] = useState("modified");
  const [filter, setFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("any");

  const currentAccount: Account = accounts.find((item) => item.id === currentIds[role] && item.role === role && item.active)
    ?? accounts.find((item) => item.role === role && item.active)
    ?? accounts.find((item) => item.id === ADMIN_ID)
    ?? { id: "sc-admin-001", name: "Olivia Chen", email: "admin@securecloud.demo", role: "admin", active: true, joined: "2024-01-12" };

  const base = role === "student" ? "/user" : `/${role}`;
  const currentPage = location.pathname.split("/").pop() || "dashboard";
  const pageLabel = navItems[role].find((item) => item.href.endsWith(currentPage))?.title ?? "Overview";
  const ownedFiles = files.filter((file) => file.ownerId === currentAccount.id);
  const storageBytes = (role === "admin" ? files : ownedFiles).reduce((sum, file) => sum + file.size, 0);
  const incomingFiles = files.filter((file) => file.shared.some((share) => share.email === currentAccount.email) && file.ownerId !== currentAccount.id);
  const listedFiles = currentPage === "shared" ? incomingFiles : currentPage === "my-shares" ? ownedFiles.filter((file) => file.shared.length) : currentPage === "files" ? role === "admin" ? files : ownedFiles : files;
  const filteredFiles = useMemo(() => listedFiles.filter((file) => {
    const matchesSearch = file.name.toLowerCase().includes(search.toLowerCase());
    const matchesType = filter === "all" || file.type.toLowerCase() === filter;
    const ageDays = (Date.now() - new Date(file.updated).getTime()) / (1000 * 60 * 60 * 24);
    const matchesDate = dateFilter === "any" || dateFilter === "today" && file.updated === today || dateFilter === "7d" && ageDays <= 7 || dateFilter === "30d" && ageDays <= 30;
    return matchesSearch && matchesType && matchesDate;
  }).sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "size" ? b.size - a.size : b.updated.localeCompare(a.updated)), [listedFiles, search, filter, dateFilter, sort]);
  const goRole = (next: Role) => navigate(rolePath(next));
  const { signOut } = useCloud();
  const logout = async () => {
    await signOut();
    toast("Signed out of your workspace.");
    navigate("/");
  };

  if (loading && accounts.length === 0) {
    return <div className="dashboard-skeleton wrap" style={{ padding: "60px 20px" }} aria-label="Loading cloud data">
      <div className="skeleton-heading"><LoadingSkeleton className="skeleton-date" /><LoadingSkeleton className="skeleton-title" /><LoadingSkeleton className="skeleton-copy" /></div>
      <div className="stat-grid">{[0, 1, 2, 3].map((item) => <div className="stat-card skeleton-card" key={item}><LoadingSkeleton className="skeleton-label" /><LoadingSkeleton className="skeleton-value" /><LoadingSkeleton className="skeleton-copy" /></div>)}</div>
    </div>;
  }

  if (error && accounts.length === 0) {
    return <div className="wrap" style={{ padding: "60px 20px", textAlign: "center" }}>
      <div className="empty-state">
        <HardDrive size={32} />
        <h3>Failed to connect to backend database</h3>
        <p>{error}</p>
        <button className="button button-primary" onClick={() => refreshData()}>Retry Connection</button>
      </div>
    </div>;
  }

  return <div className={`app-shell ${dark ? "theme-dark" : ""}`}>
    <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}><div className="sidebar-brand"><Brand /><button className="mobile-close" aria-label="Close menu" onClick={() => setMobileOpen(false)}><X size={19} /></button></div>
      <div className="workspace-label">WORKSPACE</div><div className="workspace-switch"><span className={`workspace-icon ${role}`}><RoleIcon role={role} /></span><span><strong>{roleName(role)} space</strong><small>{role === "admin" ? "Organization" : "My workspace"}</small></span></div>
      <div className="nav-section-label">MENU</div><nav className="side-nav">{navItems[role].map(({ title, href, icon: Icon }) => <Link key={href} to={href} onClick={() => setMobileOpen(false)} className={`side-link ${location.pathname === href ? "active" : ""}`}><Icon size={18} /><span>{title}</span>{title === "Shared with me" && incomingFiles.length > 0 && <span className="nav-count">{incomingFiles.length}</span>}</Link>)}</nav>
      <div className="sidebar-spacer" /><div className="storage-card"><div className="storage-top"><HardDrive size={16} /><span>Storage</span><span className="storage-demo">DEMO</span></div><div className="storage-used"><strong>{formatSize(storageBytes)}</strong><span>of {role === "admin" ? "50" : "10"} GB</span></div><div className="storage-track"><span style={{ width: `${Math.max(2, Math.min(storageBytes / ((role === "admin" ? 50 : 10) * 1024 * 1024 * 1024) * 100, 100))}%` }} /></div><small>Demo storage overview</small></div>
      <button className="sidebar-user" onClick={() => navigate(`${base}/settings`)}><span className="avatar">{avatarLetters(currentAccount.name)}</span><span><strong>{currentAccount.name}</strong><small>{roleName(role)} account</small></span><MoreHorizontal size={17} /></button>
    </aside>
    {mobileOpen && <button className="drawer-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <main className="workspace-main"><header className="workspace-header"><div className="header-left"><button className="mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={21} /></button><div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14} /><strong>{pageLabel}</strong></div></div><div className="workspace-actions"><span className="demo-status"><i /> Connected to Supabase</span><button className="header-icon" aria-label="Toggle theme" onClick={toggleTheme}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button><button className="header-icon notification-button" aria-label="Notifications" onClick={() => toast("You’re all caught up.")}><Bell size={18} /><i /></button><div className="role-picker"><span>Preview as</span><div className="select-wrap"><select value={role} onChange={(e) => goRole(e.target.value as Role)} aria-label="Preview another role"><option value="student">Student</option><option value="teacher">Teacher</option><option value="admin">Admin</option></select><ChevronDown size={13} /></div></div><button className="header-avatar avatar" onClick={() => navigate(`${base}/settings`)}>{avatarLetters(currentAccount.name)}</button></div></header>
      <div className="page-container">
        {currentPage === "dashboard" && <Dashboard role={role} account={currentAccount} onUpload={() => setUploadOpen(true)} onNavigate={(path) => navigate(`${base}/${path}`)} onDetails={setDetailsFile} />}
        {currentPage === "files" && <><PageHeading eyebrow={role === "teacher" ? "TEACHING MATERIALS" : role === "admin" ? "ORGANIZATION" : "YOUR LIBRARY"} title={role === "admin" ? "All files" : "My files"} description={role === "admin" ? "Review file metadata across the demo workspace." : "Keep your PDFs and study materials together."} action={role !== "admin" && <button className="button button-primary button-small" onClick={() => setUploadOpen(true)}><Upload size={16} /> Upload file</button>} /><FileToolbar search={search} setSearch={setSearch} filter={filter} setFilter={setFilter} dateFilter={dateFilter} setDateFilter={setDateFilter} sort={sort} setSort={setSort} viewMode={viewMode} setViewMode={setViewMode} /><FileCollection files={filteredFiles} viewMode={viewMode} readOnly={role === "admin"} onDetails={setDetailsFile} onShare={setShareFile} onRename={setRenameFile} onDelete={setConfirmFile} onDownload={(file) => downloadFile(file, currentAccount.name, (downloaded, msg) => toast(downloaded ? "File downloaded from SecureCloud storage." : msg || "Sample metadata only; upload your own PDF to test cloud download."), (detail) => log("File downloaded", detail, currentAccount.name))} />{role === "teacher" && <TeacherShareNote />}</>}
        {currentPage === "shared" && <><PageHeading eyebrow="COLLABORATION" title="Shared with me" description="Resources your teachers and classmates shared with you." /><FileToolbar search={search} setSearch={setSearch} filter={filter} setFilter={setFilter} dateFilter={dateFilter} setDateFilter={setDateFilter} sort={sort} setSort={setSort} viewMode={viewMode} setViewMode={setViewMode} /><SharedCollection files={filteredFiles} accounts={accounts} email={currentAccount.email} onDetails={setDetailsFile} onDownload={(file) => downloadFile(file, currentAccount.name, (downloaded, msg) => toast(downloaded ? "File downloaded from SecureCloud storage." : msg || "Sample metadata only; upload your own PDF to test cloud download."), (detail) => log("File downloaded", detail, currentAccount.name))} /></>}
        {currentPage === "my-shares" && <><PageHeading eyebrow="COLLABORATION" title="My shared files" description="See who has access and manage demo permissions." action={<button className="button button-primary button-small" onClick={() => ownedFiles[0] ? setShareFile(ownedFiles[0]) : setUploadOpen(true)}><Share2 size={16} /> Share a file</button>} /><FileToolbar search={search} setSearch={setSearch} filter={filter} setFilter={setFilter} dateFilter={dateFilter} setDateFilter={setDateFilter} sort={sort} setSort={setSort} viewMode={viewMode} setViewMode={setViewMode} /><SharedByMe files={filteredFiles} accounts={accounts} onShare={setShareFile} onDetails={setDetailsFile} /></>}
        {role === "admin" && currentPage === "users" && <AdminUsers onEdit={setEditUser} search={search} setSearch={setSearch} />}
        {role === "admin" && currentPage === "sharing" && <AdminSharing files={files} accounts={accounts} onDetails={setDetailsFile} />}
        {currentPage === "activity" && <ActivityPage role={role} accountName={currentAccount.name} activity={activity} search={search} setSearch={setSearch} />}
        {currentPage === "settings" && <SettingsPage account={currentAccount} role={role} onLogout={logout} />}
      </div>
    </main>
    {uploadOpen && <UploadDialog onClose={() => setUploadOpen(false)} account={currentAccount} />}
    {shareFile && <ShareDialog file={shareFile} onClose={() => setShareFile(null)} accounts={accounts} />}
    {detailsFile && <FileDetailsDialog file={detailsFile} accounts={accounts} onClose={() => setDetailsFile(null)} />}
    {confirmFile && <ConfirmDialog title="Delete this file?" description={`“${confirmFile.name}” will be removed from the local demo workspace.`} confirm="Delete file" onClose={() => setConfirmFile(null)} onConfirm={() => { removeFile(confirmFile.id); log("File deleted", confirmFile.name, currentAccount.name); setConfirmFile(null); toast("File removed from the demo workspace."); }} />}
    {editUser && <UserDialog account={editUser} onClose={() => setEditUser(null)} />}
    {renameFile && <RenameDialog file={renameFile} user={currentAccount.name} onClose={() => setRenameFile(null)} />}
  </div>;
}

function RoleIcon({ role }: { role: Role }) {
  const Icon = role === "admin" ? Shield : role === "teacher" ? BookOpen : User;
  return <Icon size={17} />;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}
function Dashboard({ role, account, onUpload, onNavigate, onDetails }: { role: Role; account: Account; onUpload: () => void; onNavigate: (path: string) => void; onDetails: (file: FileRecord) => void }) {
  const { accounts, files, activity, loading: cloudLoading } = useCloud();
  const [initialWait, setInitialWait] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setInitialWait(false), 250);
    return () => window.clearTimeout(timer);
  }, []);
  const loading = cloudLoading || initialWait;
  const myFiles = role === "admin" ? files : files.filter((file) => file.ownerId === account.id);
  const sharedCount = role === "admin" ? files.filter((file) => file.shared.length).length : files.filter((file) => file.shared.some((share) => share.email === account.email)).length;
  const totalStorage = files.reduce((sum, file) => sum + file.size, 0);
  const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening";
  const stats: [string, string, string, LucideIcon, string][] = role === "admin" ? [
    ["Total users", `${accounts.length}`, "Across your workspace", Users, "blue"],
    ["Teachers", `${accounts.filter((user) => user.role === "teacher").length}`, "Active teaching accounts", BookOpen, "purple"],
    ["Students", `${accounts.filter((user) => user.role === "student").length}`, "Active student accounts", User, "green"],
    ["Total files", `${files.length}`, formatSize(totalStorage) + " used", FolderOpen, "orange"],
  ] : [
    ["My files", `${myFiles.length.toString().padStart(2, "0")}`, "In your workspace", FolderOpen, "blue"],
    ["Shared with me", `${sharedCount.toString().padStart(2, "0")}`, role === "teacher" ? "From other educators" : "From your teachers", Share2, "purple"],
    ["Storage used", formatSize(myFiles.reduce((sum, file) => sum + file.size, 0)), "of 10 GB available", HardDrive, "green"],
    ["Shared by me", `${myFiles.filter((file) => file.shared.length).length.toString().padStart(2, "0")}`, "Files you’ve shared", Users, "orange"],
  ];
  if (loading) return <div className="dashboard-skeleton" aria-label="Loading dashboard"><div className="skeleton-heading"><LoadingSkeleton className="skeleton-date" /><LoadingSkeleton className="skeleton-title" /><LoadingSkeleton className="skeleton-copy" /></div><div className="stat-grid">{[0, 1, 2, 3].map((item) => <div className="stat-card skeleton-card" key={item}><LoadingSkeleton className="skeleton-label" /><LoadingSkeleton className="skeleton-value" /><LoadingSkeleton className="skeleton-copy" /></div>)}</div><div className="dashboard-bottom"><div className="panel-card skeleton-panel"><LoadingSkeleton className="skeleton-title" />{[0, 1, 2].map((item) => <LoadingSkeleton className="skeleton-row" key={item} />)}</div><div className="panel-card skeleton-panel"><LoadingSkeleton className="skeleton-title" />{[0, 1, 2].map((item) => <LoadingSkeleton className="skeleton-row" key={item} />)}</div></div></div>;
  return <><div className="welcome-row"><div><div className="welcome-date">{new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date()).toUpperCase()}</div><h1>{greeting}, {firstName(account.name)} <span className="wave">✦</span></h1><p>Here’s what’s happening in your workspace today.</p></div>{role !== "admin" && <button className="button button-primary" onClick={onUpload}><Upload size={17} /> Upload a file</button>}</div>
    <div className="stat-grid">{stats.map(([label, amount, caption, Icon, color]) => <StatCard key={label} label={label} value={amount} caption={caption} icon={Icon} color={color} />)}</div>
    {role === "admin" && <div className="admin-overview-grid"><div className="panel-card usage-card"><div className="card-head"><div><h3>Storage overview</h3><p>Usage across all demo accounts</p></div><span className="mini-badge">DEMO DATA</span></div><div className="usage-number">{formatSize(totalStorage)} <span>of 50 GB</span></div><div className="storage-track large"><span style={{ width: `${Math.min(totalStorage / (50 * 1024 * 1024 * 1024) * 100, 100)}%` }} /></div><div className="usage-footer"><span><i className="legend-dot blue-dot" /> PDFs & documents</span><strong>{formatSize(totalStorage)}</strong></div><div className="usage-footer"><span><i className="legend-dot pale-dot" /> Available storage</span><strong>49.9 GB</strong></div></div><div className="panel-card share-stats"><div className="card-head"><div><h3>Sharing activity</h3><p>Files with active shares</p></div><span className="share-big">{files.filter((file) => file.shared.length).length}<small>files</small></span></div><div className="share-bar"><i style={{ width: "72%" }} /></div><div className="share-labels"><span>Viewer access <b>{files.reduce((sum, file) => sum + file.shared.filter((s) => s.permission === "Viewer").length, 0)}</b></span><span>Editor access <b>{files.reduce((sum, file) => sum + file.shared.filter((s) => s.permission === "Editor").length, 0)}</b></span></div><button className="inline-link" onClick={() => onNavigate("sharing")}>View sharing details <ArrowRight size={15} /></button></div></div>}
    <div className="dashboard-bottom"><div className="panel-card recent-files"><div className="card-head"><div><h3>{role === "admin" ? "Recent files" : "Recently opened"}</h3><p>{role === "admin" ? "Latest file activity across your workspace" : "Pick up where you left off"}</p></div><button className="inline-link" onClick={() => onNavigate(role === "admin" ? "files" : "files")}>View all <ArrowRight size={15} /></button></div>
      {myFiles.slice(0, 4).map((file) => { const owner = accounts.find((user) => user.id === file.ownerId); return <button className="recent-file" key={file.id} onClick={() => onDetails(file)}><span className="file-icon pdf"><FileText size={18} /></span><span className="recent-file-name"><strong>{file.name}</strong><small>{role === "admin" ? `${owner?.name ?? "Unknown"} · ` : ""}{formatSize(file.size)} · Modified today</small></span>{file.shared.length > 0 && <span className="shared-tag"><Share2 size={13} /> Shared</span>}<MoreHorizontal size={17} /></button>; })}
      {myFiles.length === 0 && <EmptyState icon={FolderOpen} title="No files yet" text="Upload your first PDF to see it here." action={<button className="button button-outline button-small" onClick={onUpload}><Upload size={15} /> Upload a file</button>} />}
    </div><div className="panel-card activity-card"><div className="card-head"><div><h3>Recent activity</h3><p>A little movement in your space</p></div><button className="icon-button" onClick={() => onNavigate("activity")} aria-label="View activity"><ArrowRight size={16} /></button></div><ActivityTimeline activity={activity.slice(0, 4)} /></div></div>
    {role !== "admin" && <div className="role-tip"><span className="tip-icon"><ShieldCheck size={18} /></span><span><strong>Your workspace, your pace.</strong><small>{role === "teacher" ? "Share study materials with your students, right from any file." : "Your teachers’ shared resources are ready whenever you are."}</small></span><button onClick={() => onNavigate(role === "teacher" ? "files" : "shared")}>Explore <ArrowRight size={15} /></button></div>}
  </>;
}
function LoadingSkeleton({ className }: { className: string }) {
  return <span className={`loading-skeleton ${className}`} aria-hidden="true" />;
}
function StatCard({ label, value, caption, icon: Icon, color }: { label: string; value: string; caption: string; icon: LucideIcon; color: string }) {
  return <div className="stat-card"><div className="stat-card-top"><span>{label}</span><span className={`stat-icon ${color}`}><Icon size={19} /></span></div><div className="stat-value">{value}</div><div className="stat-caption"><span className="stat-dot" />{caption}</div></div>;
}
function EmptyState({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text: string; action?: ReactNode }) {
  return <div className="empty-state"><span><Icon size={25} /></span><h3>{title}</h3><p>{text}</p>{action}</div>;
}
function ActivityTimeline({ activity }: { activity: ActivityRecord[] }) {
  const iconFor = (kind: string) => kind === "share" ? Share2 : kind === "lock" ? LockKeyhole : kind === "user" ? UserPlus : Upload;
  return <div className="activity-timeline">{activity.map((item) => { const Icon = iconFor(item.icon); return <div className="timeline-item" key={item.id}><span className={`timeline-icon ${item.icon}`}><Icon size={15} /></span><div><strong>{item.action}</strong><p>{item.detail}</p><small>{item.user} <i /> {item.at}</small></div></div>; })}</div>;
}
function FileToolbar({ search, setSearch, filter, setFilter, dateFilter, setDateFilter, sort, setSort, viewMode, setViewMode }: { search: string; setSearch: (value: string) => void; filter: string; setFilter: (value: string) => void; dateFilter: string; setDateFilter: (value: string) => void; sort: string; setSort: (value: string) => void; viewMode: "grid" | "list"; setViewMode: (mode: "grid" | "list") => void }) {
  return <div className="file-toolbar"><div className="toolbar-search"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search files..." aria-label="Search files" /></div><div className="toolbar-controls"><label className="select-wrap filter-select"><Filter size={15} /><select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter file type"><option value="all">All file types</option><option value="pdf">PDF</option></select><ChevronDown size={13} /></label><label className="select-wrap date-select"><select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} aria-label="Filter by date"><option value="any">Any date</option><option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select><ChevronDown size={13} /></label><label className="select-wrap sort-select"><select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort files"><option value="modified">Last modified</option><option value="name">Name A–Z</option><option value="size">Largest size</option></select><ChevronDown size={13} /></label><div className="view-switch"><button onClick={() => setViewMode("list")} className={viewMode === "list" ? "selected" : ""} aria-label="List view"><List size={17} /></button><button onClick={() => setViewMode("grid")} className={viewMode === "grid" ? "selected" : ""} aria-label="Grid view"><LayoutDashboard size={16} /></button></div></div></div>;
}
function FileCollection({ files, viewMode, readOnly = false, onDetails, onShare, onRename, onDelete, onDownload }: { files: FileRecord[]; viewMode: "grid" | "list"; readOnly?: boolean; onDetails: (file: FileRecord) => void; onShare: (file: FileRecord) => void; onRename: (file: FileRecord) => void; onDelete: (file: FileRecord) => void; onDownload: (file: FileRecord) => void }) {
  const { accounts } = useCloud();
  if (!files.length) return <EmptyState icon={FolderOpen} title="Nothing here yet" text="Try another search, or upload a PDF to get started." />;
  if (viewMode === "grid") return <div className="file-grid">{files.map((file) => <FileCard key={file.id} file={file} owner={accounts.find((user) => user.id === file.ownerId)?.name ?? "Unknown"} readOnly={readOnly} onDetails={onDetails} onShare={onShare} onRename={onRename} onDelete={onDelete} onDownload={onDownload} />)}</div>;
  return <div className="table-wrap"><table className="data-table file-table"><thead><tr><th>Name</th><th>Owner</th><th>File size</th><th>Last modified</th><th>Sharing</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{files.map((file) => <tr key={file.id}><td><button className="table-file" onClick={() => onDetails(file)}><span className="file-icon pdf"><FileText size={17} /></span><span><strong>{file.name}</strong><small>{file.type} document</small></span></button></td><td><span className="owner-cell"><span className="avatar avatar-small">{avatarLetters(accounts.find((u) => u.id === file.ownerId)?.name ?? "?")}</span>{accounts.find((u) => u.id === file.ownerId)?.name ?? "Unknown"}</span></td><td>{formatSize(file.size)}</td><td>{file.updated === today ? "Today" : file.updated}</td><td>{file.shared.length ? <span className="shared-tag"><Share2 size={13} /> {file.shared.length} people</span> : <span className="muted">Private</span>}</td><td><FileActions file={file} readOnly={readOnly} onDetails={onDetails} onShare={onShare} onRename={onRename} onDelete={onDelete} onDownload={onDownload} /></td></tr>)}</tbody></table></div>;
}
function FileCard({ file, owner, readOnly, onDetails, onShare, onRename, onDelete, onDownload }: { file: FileRecord; owner: string; readOnly: boolean; onDetails: (file: FileRecord) => void; onShare: (file: FileRecord) => void; onRename: (file: FileRecord) => void; onDelete: (file: FileRecord) => void; onDownload: (file: FileRecord) => void }) {
  return <article className="file-card"><div className="file-card-head"><span className="file-icon pdf large-file"><FileText size={21} /></span><FileActions file={file} readOnly={readOnly} onDetails={onDetails} onShare={onShare} onRename={onRename} onDelete={onDelete} onDownload={onDownload} /></div><button className="file-card-name" onClick={() => onDetails(file)}>{file.name}</button><p>{owner}</p><div className="file-card-foot"><span>{formatSize(file.size)} · {file.updated === today ? "Today" : file.updated}</span>{file.shared.length > 0 && <Share2 size={14} />}</div></article>;
}
function FileActions({ file, readOnly = false, onDetails, onShare, onRename, onDelete, onDownload }: { file: FileRecord; readOnly?: boolean; onDetails: (file: FileRecord) => void; onShare: (file: FileRecord) => void; onRename: (file: FileRecord) => void; onDelete: (file: FileRecord) => void; onDownload: (file: FileRecord) => void }) {
  if (readOnly) return <div className="action-buttons"><button aria-label={`View details for ${file.name}`} onClick={() => onDetails(file)}><Eye size={15} /></button></div>;
  return <div className="action-buttons"><button aria-label={`View details for ${file.name}`} onClick={() => onDetails(file)}><Eye size={15} /></button><button aria-label={`Rename ${file.name}`} onClick={() => onRename(file)}><Pencil size={15} /></button><button aria-label={`Share ${file.name}`} onClick={() => onShare(file)}><Share2 size={15} /></button><button aria-label={`Download ${file.name}`} onClick={() => onDownload(file)}><Download size={15} /></button><button aria-label={`Delete ${file.name}`} onClick={() => onDelete(file)}><Trash2 size={15} /></button></div>;
}
function SharedCollection({ files, accounts, email, onDetails, onDownload }: { files: FileRecord[]; accounts: Account[]; email: string; onDetails: (file: FileRecord) => void; onDownload: (file: FileRecord) => void }) {
  if (!files.length) return <EmptyState icon={Share2} title="Nothing shared with you yet" text="When someone shares a resource, it’ll show up here." />;
  return <div className="table-wrap"><table className="data-table file-table"><thead><tr><th>File</th><th>Owner</th><th>Shared on</th><th>Permission</th><th>Size</th><th /></tr></thead><tbody>{files.map((file) => { const permission = file.shared.find((s) => s.email === email)?.permission; const owner = accounts.find((a) => a.id === file.ownerId); return <tr key={file.id}><td><button className="table-file" onClick={() => onDetails(file)}><span className="file-icon pdf"><FileText size={17} /></span><span><strong>{file.name}</strong><small>PDF document</small></span></button></td><td><span className="owner-cell"><span className="avatar avatar-small">{avatarLetters(owner?.name ?? "?")}</span>{owner?.name ?? "Unknown"}</span></td><td>Today</td><td><span className={`permission-tag ${permission === "Editor" ? "editor" : ""}`}>{permission}</span></td><td>{formatSize(file.size)}</td><td><button className="icon-button" aria-label={`Download ${file.name}`} onClick={() => onDownload(file)}><Download size={16} /></button></td></tr>; })}</tbody></table></div>;
}
function SharedByMe({ files, accounts, onShare, onDetails }: { files: FileRecord[]; accounts: Account[]; onShare: (file: FileRecord) => void; onDetails: (file: FileRecord) => void }) {
  if (!files.length) return <EmptyState icon={Share2} title="You haven’t shared anything yet" text="Choose a file and invite someone to view or edit it." />;
  return <div className="share-list">{files.map((file) => <article className="share-row" key={file.id}><span className="file-icon pdf"><FileText size={18} /></span><button className="share-row-name" onClick={() => onDetails(file)}><strong>{file.name}</strong><small>{formatSize(file.size)} · Shared with {file.shared.length} {file.shared.length === 1 ? "person" : "people"}</small></button><div className="share-recipients">{file.shared.map((share) => { const user = accounts.find((account) => account.email === share.email); return <span key={share.email}><span className="avatar avatar-small">{avatarLetters(user?.name ?? share.email)}</span>{user?.name ?? share.email}<em>{share.permission}</em></span>; })}</div><button className="button button-outline button-small" onClick={() => onShare(file)}><Settings size={14} /> Manage</button></article>)}</div>;
}
function TeacherShareNote() {
  return <div className="teacher-note"><BookOpen size={17} /><span>Teacher workspace</span><p>Share materials with students from any file using the share action.</p></div>;
}

function UploadDialog({ onClose, account }: { onClose: () => void; account: Account }) {
  const { addFile, log, toast, maxFileSizeMB } = useCloud();
  const [selected, setSelected] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const choose = (file?: File) => {
    setError("");
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setSelected(null);
      return setError("This cloud workspace accepts PDF files only.");
    }
    if (file.size > maxFileSizeMB * 1024 * 1024) {
      setSelected(null);
      return setError(`That file is over the ${maxFileSizeMB} MB upload limit.`);
    }
    setSelected(file);
  };

  const upload = async () => {
    if (!selected || isUploading) return;
    setIsUploading(true);
    setProgress(15);
    setError("");

    try {
      const fileId = crypto.randomUUID();
      const sanitizedName = selected.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${fileId}_${sanitizedName}`;

      setProgress(40);

      // Upload directly to Supabase Storage bucket 'securecloud-files'
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from("securecloud-files")
        .upload(storagePath, selected, {
          cacheControl: "3600",
          upsert: true,
        });

      if (uploadErr) {
        console.error("Storage upload error:", uploadErr);
        // If storage fails, still inform user
        setError(uploadErr.message || "Failed to upload file to storage.");
        setIsUploading(false);
        setProgress(0);
        return;
      }

      setProgress(85);

      const record: FileRecord = {
        id: fileId,
        name: selected.name,
        size: selected.size,
        type: "PDF",
        ownerId: account.id,
        updated: today,
        uploaded: today,
        storagePath: uploadData?.path || storagePath,
        shared: [],
        blob: selected,
      };

      const added = await addFile(record);
      if (added) {
        await log("File uploaded", selected.name, account.name);
        setProgress(100);
        toast("File successfully uploaded to SecureCloud!");
        window.setTimeout(() => {
          onClose();
        }, 500);
      } else {
        setError("File saved to storage but failed to create database record.");
        setIsUploading(false);
      }
    } catch (err: unknown) {
      console.error("Upload error:", err);
      setError(err instanceof Error ? err.message : "Error uploading file");
      setIsUploading(false);
      setProgress(0);
    }
  };

  return <Modal onClose={onClose} title="Upload a file" subtitle="Add a PDF to your secure workspace.">
    <div className={`dropzone ${dragging ? "dragging" : ""}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); choose(e.dataTransfer.files[0]); }}>
      <input ref={inputRef} type="file" accept=".pdf,application/pdf" className="sr-only" onChange={(e) => choose(e.target.files?.[0])} />
      <span className="drop-icon"><CloudUpload size={27} /></span><strong>Drag your PDF here</strong><span>or</span><button className="button button-outline button-small" type="button" onClick={() => inputRef.current?.click()}>Browse files</button><small>PDF only · Up to {maxFileSizeMB} MB · Supabase Storage</small>
    </div>
    {selected && <div className="selected-file"><span className="file-icon pdf"><FileText size={17} /></span><span><strong>{selected.name}</strong><small>{formatSize(selected.size)}</small></span>{progress === 0 && <button aria-label="Remove selected file" onClick={() => setSelected(null)}><X size={17} /></button>}</div>}
    {progress > 0 && <div className="progress-block"><div><span>{progress === 100 ? "File stored in Supabase Storage" : "Uploading to securecloud-files…"}</span><b>{progress}%</b></div><div className="progress-track"><i style={{ width: `${progress}%` }} /></div></div>}
    {error && <div className="form-error">{error}</div>}
    <div className="dialog-note"><Shield size={15} /> Encrypted at rest in Supabase Storage with bucket-level policies.</div>
    <div className="modal-actions"><button className="button button-quiet" onClick={onClose} disabled={isUploading}>Cancel</button><button className="button button-primary" disabled={!selected || isUploading} onClick={upload}>{isUploading ? "Uploading…" : <><Upload size={16} /> Upload PDF</>}</button></div>
  </Modal>;
}
function ShareDialog({ file, onClose, accounts }: { file: FileRecord; onClose: () => void; accounts: Account[] }) {
  const { updateFile, log, toast } = useCloud();
  const [recipient, setRecipient] = useState("");
  const [permission, setPermission] = useState<Permission>("Viewer");
  const [error, setError] = useState("");
  const eligible = accounts.filter((account) => account.active && account.email !== accounts.find((user) => user.id === file.ownerId)?.email && account.role !== "admin");
  const handleSave = (event: FormEvent) => {
    event.preventDefault();
    if (!recipient) return setError("Choose someone to share this file with.");
    const person = eligible.find((account) => account.email === recipient);
    if (!person) return setError("That recipient is not available.");
    const existing = file.shared.some((share) => share.email === recipient);
    const shared = existing ? file.shared.map((share) => share.email === recipient ? { ...share, permission } : share) : [...file.shared, { email: recipient, permission }];
    updateFile(file.id, { shared });
    log(existing ? "Permission changed" : "File shared", `${file.name} · ${person.name} · ${permission}`, accounts.find((a) => a.id === file.ownerId)?.name ?? "User");
    toast(existing ? "Sharing permission updated in Supabase." : "File shared successfully.");
    onClose();
  };
  const revoke = (email: string) => {
    if (!window.confirm(`Revoke access for ${email}?`)) return;
    updateFile(file.id, { shared: file.shared.filter((share) => share.email !== email) });
    log("Share revoked", `${file.name} · ${email}`);
    toast("Access revoked in Supabase.");
  };
  return <Modal onClose={onClose} title="Share file" subtitle={file.name}>
    <div className="share-demo-notice"><Share2 size={16} /> Row Level Security enforces access for granted recipients.</div>
    {file.shared.length > 0 && <div className="existing-shares"><h4>People with access</h4>{file.shared.map((share) => { const person = accounts.find((account) => account.email === share.email); return <div className="existing-share" key={share.email}><span className="avatar avatar-small">{avatarLetters(person?.name ?? share.email)}</span><span><strong>{person?.name ?? share.email}</strong><small>{share.email}</small></span><span className={`permission-tag ${share.permission === "Editor" ? "editor" : ""}`}>{share.permission}</span><button aria-label={`Revoke access for ${share.email}`} onClick={() => revoke(share.email)}><X size={15} /></button></div>; })}</div>}
    <form onSubmit={handleSave}><label className="field"><span>Add a person</span><div className="select-wrap select-full"><select value={recipient} onChange={(e) => { setRecipient(e.target.value); setError(""); }}><option value="">Choose an account…</option>{eligible.map((account) => <option key={account.id} value={account.email}>{account.name} · {roleName(account.role)}</option>)}</select><ChevronDown size={15} /></div></label><label className="field"><span>Permission</span><div className="select-wrap select-full"><select value={permission} onChange={(e) => setPermission(e.target.value as Permission)}><option value="Viewer">Viewer · Can view and download</option><option value="Editor">Editor · Can edit metadata</option></select><ChevronDown size={15} /></div></label>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary"><Share2 size={16} /> Save sharing</button></div></form>
  </Modal>;
}
function FileDetailsDialog({ file, accounts, onClose }: { file: FileRecord; accounts: Account[]; onClose: () => void }) {
  const owner = accounts.find((account) => account.id === file.ownerId);
  return <Modal onClose={onClose} title="File details" subtitle="File details from PostgreSQL and Storage.">
    <div className="detail-file-banner"><span className="file-icon pdf large-file"><FileText size={22} /></span><span><strong>{file.name}</strong><small>{file.type} document · {formatSize(file.size)}</small></span></div>
    <div className="detail-grid"><Detail label="Owner" value={owner?.name ?? "Unknown"} /><Detail label="Uploaded" value={file.uploaded === today ? "Today" : file.uploaded} /><Detail label="Last modified" value={file.updated === today ? "Today" : file.updated} /><Detail label="File type" value={file.type} /></div>
    <div className="encryption-placeholder"><LockKeyhole size={16} /><span><strong>Supabase Storage</strong><small>{file.storagePath ? `Bucket path: ${file.storagePath}` : "Sample metadata file"}</small></span><span className="placeholder-pill" style={{ color: "#10b981", borderColor: "#10b981" }}>{file.storagePath ? "LIVE OBJECT" : "SAMPLE"}</span></div>
    <div className="detail-sharing"><h4>Sharing details <span>{file.shared.length} people</span></h4>{file.shared.length ? file.shared.map((share) => { const person = accounts.find((account) => account.email === share.email); return <div className="detail-share-line" key={share.email}><span className="avatar avatar-small">{avatarLetters(person?.name ?? share.email)}</span><span>{person?.name ?? share.email}</span><span className={`permission-tag ${share.permission === "Editor" ? "editor" : ""}`}>{share.permission}</span></div>; }) : <p className="muted">This file hasn’t been shared.</p>}</div>
    <div className="modal-actions"><button className="button button-primary" onClick={onClose}>Done</button></div>
  </Modal>;
}
function Detail({ label, value }: { label: string; value: string }) {
  return <div className="detail-cell"><small>{label}</small><strong>{value}</strong></div>;
}
function Modal({ onClose, title, subtitle, children }: { onClose: () => void; title: string; subtitle?: string; children: ReactNode }) {
  return <div className="modal-scrim" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><header className="modal-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={19} /></button></header><div className="modal-body">{children}</div></section></div>;
}
function ConfirmDialog({ title, description, confirm, onClose, onConfirm }: { title: string; description: string; confirm: string; onClose: () => void; onConfirm: () => void }) {
  return <Modal onClose={onClose} title={title}><div className="confirm-content"><span className="confirm-icon"><Trash2 size={21} /></span><p>{description}</p></div><div className="modal-actions"><button className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-danger" onClick={onConfirm}>{confirm}</button></div></Modal>;
}
async function downloadFile(
  file: FileRecord,
  user: string,
  onReady: (downloaded: boolean, errMessage?: string) => void,
  onLog: (detail: string) => void
) {
  // If in-memory blob is present
  if (file.blob) {
    const href = URL.createObjectURL(file.blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = file.name;
    link.click();
    URL.revokeObjectURL(href);
    onLog(`${file.name} · downloaded by ${user}`);
    onReady(true);
    return;
  }

  // If storagePath is present in Supabase Storage
  if (file.storagePath) {
    try {
      const { data: blobData, error: dlErr } = await supabase.storage
        .from("securecloud-files")
        .download(file.storagePath);

      if (dlErr) {
        console.error("Storage download error:", dlErr);
        onLog(`${file.name} · storage download failed for ${user}`);
        onReady(false, dlErr.message);
        return;
      }

      if (blobData) {
        const href = URL.createObjectURL(blobData);
        const link = document.createElement("a");
        link.href = href;
        link.download = file.name;
        link.click();
        URL.revokeObjectURL(href);
        onLog(`${file.name} · downloaded from storage by ${user}`);
        onReady(true);
        return;
      }
    } catch (e: unknown) {
      console.error("Download exception:", e);
      onReady(false, e instanceof Error ? e.message : "Download failed");
      return;
    }
  }

  // Fallback for initial seeded records without a storage file
  onLog(`${file.name} · download requested by ${user} (sample metadata only)`);
  onReady(false);
}
function RenameDialog({ file, user, onClose }: { file: FileRecord; user: string; onClose: () => void }) {
  const { updateFile, log, toast } = useCloud();
  const [name, setName] = useState(file.name);
  const [error, setError] = useState("");
  const save = (event: FormEvent) => {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName) return setError("File name can’t be empty.");
    if (!nextName.toLowerCase().endsWith(".pdf")) return setError("Keep the .pdf file extension.");
    updateFile(file.id, { name: nextName, updated: today });
    log("File renamed", `${file.name} → ${nextName}`, user);
    toast("File renamed in the demo workspace.");
    onClose();
  };
  return <Modal onClose={onClose} title="Rename file" subtitle="This changes the name in your local demo only."><form onSubmit={save}><label className="field"><span>File name</span><div className="input-wrap"><FileText size={16} /><input autoFocus value={name} onChange={(event) => { setName(event.target.value); setError(""); }} /></div></label>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary"><Check size={15} /> Save name</button></div></form></Modal>;
}
function AdminUsers({ onEdit, search, setSearch }: { onEdit: (account: Account) => void; search: string; setSearch: (value: string) => void }) {
  const { accounts, files, updateAccount, toast, log } = useCloud();
  const [roleFilter, setRoleFilter] = useState("all");
  const [sortUsers, setSortUsers] = useState("name");
  const [adding, setAdding] = useState(false);
  const visible = accounts.filter((account) => account.id !== ADMIN_ID)
    .filter((account) => `${account.name} ${account.email}`.toLowerCase().includes(search.toLowerCase()))
    .filter((account) => roleFilter === "all" || account.role === roleFilter)
    .sort((a, b) => sortUsers === "email" ? a.email.localeCompare(b.email) : sortUsers === "joined" ? b.joined.localeCompare(a.joined) : a.name.localeCompare(b.name));
  const toggleActive = (account: Account) => {
    const action = account.active ? "deactivate" : "activate";
    if (!window.confirm(`Are you sure you want to ${action} ${account.name} in this demo?`)) return;
    updateAccount(account.id, { active: !account.active });
    log(account.active ? "Account deactivated" : "Account activated", account.name, "Olivia Chen");
    toast(`Demo account ${account.active ? "deactivated" : "activated"}.`);
  };
  return <><PageHeading eyebrow="PEOPLE & ACCESS" title="User management" description="Manage Teacher and Student demo accounts." action={<button className="button button-primary button-small" onClick={() => setAdding(true)}><UserPlus size={16} /> Add user</button>} />
    <div className="user-summary"><span><Users size={17} /> {accounts.length} accounts <i /> 1 designated Admin <i /> {accounts.filter((a) => a.active && a.role !== "admin").length} active</span><span className="admin-only-note"><ShieldCheck size={15} /> Admin creation is disabled</span></div>
    <div className="file-toolbar"><div className="toolbar-search"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email..." aria-label="Search users" /></div><div className="toolbar-controls"><label className="select-wrap filter-select"><Filter size={15} /><select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Filter by role"><option value="all">All roles</option><option value="teacher">Teachers</option><option value="student">Students</option></select><ChevronDown size={13} /></label><label className="select-wrap sort-select"><select value={sortUsers} onChange={(e) => setSortUsers(e.target.value)} aria-label="Sort users"><option value="name">Name A–Z</option><option value="email">Email A–Z</option><option value="joined">Recently joined</option></select><ChevronDown size={13} /></label></div></div>
    <div className="table-wrap"><table className="data-table user-table"><thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Joined</th><th>Files</th><th>Actions</th></tr></thead><tbody>{visible.map((account) => <tr key={account.id}><td><span className="user-cell"><span className="avatar">{avatarLetters(account.name)}</span><span><strong>{account.name}</strong><small>{account.email}</small></span></span></td><td><span className={`role-badge ${account.role}`}>{roleName(account.role)}</span></td><td><span className={`status-badge ${account.active ? "active" : "inactive"}`}><i />{account.active ? "Active" : "Inactive"}</span></td><td>{account.joined}</td><td>{files.filter((file) => file.ownerId === account.id).length}</td><td><div className="user-actions"><button onClick={() => onEdit(account)} aria-label={`Edit ${account.name}`}><Pencil size={15} /></button><button onClick={() => toggleActive(account)}>{account.active ? "Deactivate" : "Activate"}</button></div></td></tr>)}</tbody></table></div>
    {visible.length === 0 && <EmptyState icon={Users} title="No users found" text="Try a different search or role filter." />}
    {adding && <UserDialog onClose={() => setAdding(false)} />}
  </>;
}
function UserDialog({ account, onClose }: { account?: Account; onClose: () => void }) {
  const { accounts, addAccount, updateAccount, toast, log } = useCloud();
  const [name, setName] = useState(account?.name ?? "");
  const [email, setEmail] = useState(account?.email ?? "");
  const [role, setRole] = useState<Role>(account?.role === "teacher" ? "teacher" : "student");
  const [error, setError] = useState("");
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !email.trim()) return setError("Name and email are required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("Enter a valid email address.");
    if (accounts.some((item) => item.email.toLowerCase() === email.toLowerCase() && item.id !== account?.id)) return setError("This email is already in use.");
    if (account) {
      if (account.role !== role && !window.confirm(`Change ${account.name} from ${roleName(account.role)} to ${roleName(role)} in this demo?`)) return;
      updateAccount(account.id, { name: name.trim(), email: email.trim(), role });
      log("Account updated", `${name.trim()} · ${roleName(role)}`, "Olivia Chen");
      toast("Demo account updated.");
    } else {
      addAccount({ id: crypto.randomUUID(), name: name.trim(), email: email.trim(), role, active: true, joined: today });
      log("Account created", `${name.trim()} · ${roleName(role)}`, "Olivia Chen");
      toast(`${roleName(role)} demo account created.`);
    }
    onClose();
  };
  return <Modal onClose={onClose} title={account ? "Edit account" : "Add a demo account"} subtitle="Only Teacher and Student accounts can be managed here."><form onSubmit={save}><label className="field"><span>Full name</span><div className="input-wrap"><User size={16} /><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" /></div></label><label className="field"><span>Email address</span><div className="input-wrap"><span className="input-at">@</span><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="name@school.edu" /></div></label><label className="field"><span>Role</span><div className="select-wrap select-full"><select value={role} onChange={(e) => setRole(e.target.value as Role)}><option value="student">Student</option><option value="teacher">Teacher</option></select><ChevronDown size={15} /></div></label><div className="dialog-note"><ShieldCheck size={15} /> The single designated Admin role cannot be assigned or created here.</div>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary">{account ? "Save changes" : "Create demo account"}</button></div></form></Modal>;
}
function AdminSharing({ files, accounts, onDetails }: { files: FileRecord[]; accounts: Account[]; onDetails: (file: FileRecord) => void }) {
  const shared = files.filter((file) => file.shared.length > 0);
  return <><PageHeading eyebrow="ORGANIZATION" title="Sharing activity" description="Review the demo files and people currently sharing access." /><div className="sharing-summary"><StatCard label="Shared files" value={`${shared.length}`} caption="With one or more people" icon={Share2} color="purple" /><StatCard label="Active shares" value={`${shared.reduce((sum, file) => sum + file.shared.length, 0)}`} caption="Viewer and Editor access" icon={Users} color="blue" /></div><div className="table-wrap"><table className="data-table"><thead><tr><th>File</th><th>Owner</th><th>Recipients</th><th>Permissions</th><th /></tr></thead><tbody>{shared.map((file) => <tr key={file.id}><td><button className="table-file" onClick={() => onDetails(file)}><span className="file-icon pdf"><FileText size={17} /></span><span><strong>{file.name}</strong><small>{formatSize(file.size)}</small></span></button></td><td>{accounts.find((a) => a.id === file.ownerId)?.name ?? "Unknown"}</td><td>{file.shared.map((share) => accounts.find((a) => a.email === share.email)?.name ?? share.email).join(", ")}</td><td>{file.shared.map((share) => <span key={share.email} className={`permission-tag ${share.permission === "Editor" ? "editor" : ""}`}>{share.permission}</span>)}</td><td><button className="icon-button" onClick={() => onDetails(file)} aria-label="View sharing details"><Eye size={16} /></button></td></tr>)}</tbody></table></div>{!shared.length && <EmptyState icon={Share2} title="No shared files" text="Shared file activity will appear here." />}</>;
}
function ActivityPage({ role, accountName, activity, search, setSearch }: { role: Role; accountName: string; activity: ActivityRecord[]; search: string; setSearch: (value: string) => void }) {
  const [kind, setKind] = useState("all");
  const items = activity.filter((item) => role === "admin" || item.user === accountName || item.detail.toLowerCase().includes(accountName.toLowerCase()))
    .filter((item) => `${item.action} ${item.detail} ${item.user}`.toLowerCase().includes(search.toLowerCase()))
    .filter((item) => kind === "all" || item.action.toLowerCase().includes(kind));
  return <><PageHeading eyebrow="WORKSPACE HISTORY" title="Activity" description="A record of uploads, downloads, sharing, and account changes." /><div className="file-toolbar"><div className="toolbar-search"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search activity..." aria-label="Search activity" /></div><label className="select-wrap filter-select"><Filter size={15} /><select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Filter activity"><option value="all">All activity</option><option value="file">File events</option><option value="share">Sharing</option><option value="permission">Permissions</option><option value="account">Accounts</option></select><ChevronDown size={13} /></label></div><div className="panel-card activity-full">{items.length ? items.map((item) => <ActivityRow key={item.id} item={item} />) : <EmptyState icon={Activity} title="No matching activity" text="Try another search or activity type." />}</div><div className="audit-placeholder"><LockKeyhole size={16} /> These are local demo events, not a tamper-proof audit log.</div></>;
}
function ActivityRow({ item }: { item: ActivityRecord }) {
  const Icon = item.icon === "share" ? Share2 : item.icon === "lock" ? LockKeyhole : item.icon === "user" ? UserPlus : Upload;
  return <div className="activity-row"><span className={`timeline-icon ${item.icon}`}><Icon size={16} /></span><span><strong>{item.action}</strong><small>{item.detail}</small></span><span className="activity-who">{item.user}</span><time>{item.at}</time></div>;
}
function SettingsPage({ account, role, onLogout }: { account: Account; role: Role; onLogout: () => void }) {
  const { accounts, updateAccount, dark, toggleTheme, toast, maxFileSizeMB, setMaxFileSizeMB } = useCloud();
  const [name, setName] = useState(account.name);
  const [email, setEmail] = useState(account.email);
  const [notifications, setNotifications] = useState(true);
  const [saved, setSaved] = useState(true);
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast("Enter a name and a valid email address.");
    if (accounts.some((other) => other.email.toLowerCase() === email.trim().toLowerCase() && other.id !== account.id)) return toast("That email address belongs to another demo account.");
    updateAccount(account.id, { name: name.trim(), email: email.trim() });
    setSaved(true); toast("Profile updated in the local demo workspace.");
  };
  return <><PageHeading eyebrow="PERSONALIZE YOUR SPACE" title="Profile & settings" description="Manage your profile preferences for this demo workspace." /><div className="settings-layout"><section className="panel-card settings-panel"><div className="card-head"><div><h3>Profile information</h3><p>Update the details shown in your workspace.</p></div><span className="avatar profile-avatar">{avatarLetters(account.name)}</span></div><form onSubmit={save}><label className="field"><span>Full name</span><div className="input-wrap"><User size={16} /><input value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} /></div></label><label className="field"><span>Email address</span><div className="input-wrap"><span className="input-at">@</span><input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setSaved(false); }} /></div></label><div className="field"><span>Current role</span><div className="role-display"><span className={`role-badge ${role}`}>{roleName(role)}</span><small>Role changes are managed in this demo workspace.</small></div></div><button className="button button-primary button-small" disabled={saved} type="submit">{saved ? <><Check size={15} /> Saved</> : "Save profile"}</button></form></section><section className="panel-card settings-panel"><div className="card-head"><div><h3>Preferences</h3><p>Make SecureCloud feel like yours.</p></div><Settings size={19} className="muted" /></div><div className="setting-row"><span className="setting-icon"><Moon size={17} /></span><span><strong>Appearance</strong><small>{dark ? "Dark theme" : "Light theme"}</small></span><button className={`switch ${dark ? "on" : ""}`} aria-label="Toggle dark theme" onClick={toggleTheme}><i /></button></div><div className="setting-row"><span className="setting-icon"><Bell size={17} /></span><span><strong>Notifications</strong><small>Updates about shared files</small></span><button className={`switch ${notifications ? "on" : ""}`} aria-label="Toggle notifications" onClick={() => { setNotifications(!notifications); toast(notifications ? "Demo notifications paused." : "Demo notifications enabled."); }}><i /></button></div>{role === "admin" && <div className="admin-demo-settings"><h4>Workspace demo settings</h4><p>Configure the local PDF upload limit for all preview workspaces.</p><label className="field"><span>Maximum PDF size</span><div className="select-wrap select-full"><select value={maxFileSizeMB} onChange={(event) => { setMaxFileSizeMB(Number(event.target.value)); toast(`Demo upload limit set to ${event.target.value} MB.`); }}><option value={10}>10 MB</option><option value={25}>25 MB</option><option value={50}>50 MB</option></select><ChevronDown size={15} /></div></label><small>Applies to simulated uploads only. It does not configure cloud storage.</small></div>}<div className="settings-demo-note"><CircleHelp size={16} /><span><strong>Demo settings</strong><small>Changes apply only in this frontend preview. Authentication preferences will be connected later.</small></span></div><button className="button button-outline signout-button" onClick={onLogout}><LogOut size={16} /> Sign out of demo</button></section></div></>;
}
