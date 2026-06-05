import { useState, useEffect, useCallback } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";

// ── Firebase config ───────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyA9xfuQHTlxrhe9fBIqaSeBMBxKMuDFa7w",
  authDomain: "budget-app-a291b.firebaseapp.com",
  projectId: "budget-app-a291b",
  storageBucket: "budget-app-a291b.firebasestorage.app",
  messagingSenderId: "391238833896",
  appId: "1:391238833896:web:54c66c406851bb774d5b5d"
};
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
// ─────────────────────────────────────────────────────────────────────────────

const PASSWORD = "MYPASSWORD"; // ← replace with your real password

const COLORS = ["#6366f1","#f59e0b","#10b981","#ef4444","#3b82f6","#ec4899","#14b8a6","#f97316","#8b5cf6","#84cc16"];

const DEFAULT_CATEGORIES = [
  { id: 1, name: "Rent", budget: 1500, color: COLORS[0] },
  { id: 2, name: "Food", budget: 600, color: COLORS[1] },
  { id: 3, name: "Transport", budget: 200, color: COLORS[2] },
  { id: 4, name: "Entertainment", budget: 150, color: COLORS[3] },
  { id: 5, name: "Health", budget: 100, color: COLORS[4] },
];

const fmt = n => `$${Number(n).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthKey = (y, m) => `${y}-${String(m+1).padStart(2,"0")}`;
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState(false);

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [expenses, setExpenses] = useState({});
  const [income, setIncome] = useState(5000);
  const [view, setView] = useState("dashboard");
  const [activeCategory, setActiveCategory] = useState(null);
  const [form, setForm] = useState({ amount: "", categoryId: "", note: "", date: new Date().toISOString().split("T")[0] });
  const [newCat, setNewCat] = useState({ name: "", budget: "" });
  const [editIncome, setEditIncome] = useState(false);
  const [incomeInput, setIncomeInput] = useState(5000);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");

  // Load from Firestore
  useEffect(() => {
    if (!authed) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "budget", "data"));
        if (snap.exists()) {
          const d = snap.data();
          if (d.categories) setCategories(d.categories);
          if (d.expenses) setExpenses(d.expenses);
          if (d.income) { setIncome(d.income); setIncomeInput(d.income); }
        }
      } catch(e) { console.error(e); }
      setLoaded(true);
    })();
  }, [authed]);

  const save = useCallback(async (cats, exps, inc) => {
    try {
      await setDoc(doc(db, "budget", "data"), { categories: cats, expenses: exps, income: inc });
      setSaveStatus("Saved ✓");
      setTimeout(() => setSaveStatus(""), 2000);
    } catch(e) { setSaveStatus("Save failed"); }
  }, []);

  const mk = monthKey(year, month);
  const monthExpenses = expenses[mk] || [];

  const spentByCategory = categories.reduce((acc, c) => {
    acc[c.id] = monthExpenses.filter(e => e.categoryId === c.id).reduce((s, e) => s + Number(e.amount), 0);
    return acc;
  }, {});

  const totalBudget = categories.reduce((s, c) => s + Number(c.budget), 0);
  const totalSpent = Object.values(spentByCategory).reduce((s, v) => s + v, 0);
  const totalRemaining = income - totalSpent;

  const addExpense = () => {
    if (!form.amount || !form.categoryId || isNaN(Number(form.amount)) || Number(form.amount) <= 0) return;
    const newExp = { id: Date.now(), amount: Number(form.amount), categoryId: Number(form.categoryId), note: form.note, date: form.date };
    const updated = { ...expenses, [mk]: [...monthExpenses, newExp] };
    setExpenses(updated);
    setForm(f => ({ ...f, amount: "", note: "" }));
    save(categories, updated, income);
  };

  const deleteExpense = (id) => {
    const updated = { ...expenses, [mk]: monthExpenses.filter(e => e.id !== id) };
    setExpenses(updated);
    save(categories, updated, income);
  };

  const addCategory = () => {
    if (!newCat.name || !newCat.budget || isNaN(Number(newCat.budget))) return;
    const c = { id: Date.now(), name: newCat.name, budget: Number(newCat.budget), color: newCat.color || COLORS[categories.length % COLORS.length] };
    const updated = [...categories, c];
    setCategories(updated);
    setNewCat({ name: "", budget: "", color: COLORS[categories.length % COLORS.length] });
    save(updated, expenses, income);
  };

  const updateCategoryColor = (id, color) => {
    const updated = categories.map(c => c.id === id ? { ...c, color } : c);
    setCategories(updated);
    save(updated, expenses, income);
  };

  const deleteCategory = (id) => {
    const updated = categories.filter(c => c.id !== id);
    setCategories(updated);
    save(updated, expenses, income);
  };

  const saveIncome = () => {
    const v = Number(incomeInput);
    if (!isNaN(v) && v > 0) { setIncome(v); setEditIncome(false); save(categories, expenses, v); }
  };

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y-1); } else setMonth(m => m-1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y+1); } else setMonth(m => m+1); };

  const DonutChart = () => {
    const r = 60, cx = 80, cy = 80, circ = 2 * Math.PI * r;
    let offset = 0;
    const slices = totalSpent > 0 ? categories.map(c => {
      const pct = spentByCategory[c.id] / totalSpent;
      const dash = pct * circ;
      const s = { color: c.color, dash, offset };
      offset += dash;
      return s;
    }) : [];
    return (
      <svg width="160" height="160" viewBox="0 0 160 160">
        {totalSpent === 0 ? <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e5e7eb" strokeWidth="20"/>
        : slices.map((s,i) => (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth="20"
            strokeDasharray={`${s.dash} ${circ-s.dash}`}
            strokeDashoffset={-s.offset+circ*0.25}
            style={{transform:"rotate(-90deg)",transformOrigin:`${cx}px ${cy}px`}}
          />
        ))}
        <text x={cx} y={cy-8} textAnchor="middle" fontSize="11" fill="#6b7280">Spent</text>
        <text x={cx} y={cy+10} textAnchor="middle" fontSize="14" fontWeight="700" fill="#111827">{fmt(totalSpent)}</text>
      </svg>
    );
  };

  const base = { fontFamily:"'Inter',system-ui,sans-serif", minHeight:"100vh", background:"#f9fafb", color:"#111827" };
  const card = { background:"#fff", borderRadius:12, padding:20, boxShadow:"0 1px 4px rgba(0,0,0,0.08)", marginBottom:16 };
  const btn = (bg="#6366f1",color="#fff") => ({ background:bg, color, border:"none", borderRadius:8, padding:"8px 16px", cursor:"pointer", fontSize:14, fontWeight:600 });
  const inp = { border:"1.5px solid #e5e7eb", borderRadius:8, padding:"8px 12px", fontSize:14, outline:"none", width:"100%", boxSizing:"border-box" };

  // ── Password screen ──
  if (!authed) {
    return (
      <div style={{...base,display:"flex",alignItems:"center",justifyContent:"center"}}>
        <div style={{...card,width:300,textAlign:"center"}}>
          <div style={{fontSize:32,marginBottom:8}}>💰</div>
          <h2 style={{margin:"0 0 20px",fontSize:20}}>Budget Tracker</h2>
          <input
            style={{...inp,marginBottom:10,textAlign:"center",letterSpacing:2}}
            type="password"
            placeholder="Enter password"
            value={pwInput}
            onChange={e => { setPwInput(e.target.value); setPwError(false); }}
            onKeyDown={e => {
              if (e.key === "Enter") {
                if (pwInput === PASSWORD) setAuthed(true);
                else setPwError(true);
              }
            }}
          />
          {pwError && <div style={{color:"#ef4444",fontSize:13,marginBottom:8}}>Incorrect password</div>}
          <button style={{...btn(),width:"100%",padding:10}} onClick={() => {
            if (pwInput === PASSWORD) setAuthed(true);
            else setPwError(true);
          }}>Unlock</button>
        </div>
      </div>
    );
  }

  if (!loaded) return <div style={{...base,display:"flex",alignItems:"center",justifyContent:"center",color:"#6b7280"}}>Loading...</div>;

  // ── Category drill-down ──
  if (view === "category" && activeCategory) {
    const cat = categories.find(c => c.id === activeCategory);
    const catExps = monthExpenses.filter(e => e.categoryId === activeCategory).sort((a,b) => new Date(b.date)-new Date(a.date));
    const spent = spentByCategory[activeCategory] || 0;
    const pct = Math.min((spent/cat.budget)*100,100);
    return (
      <div style={base}>
        <div style={{maxWidth:600,margin:"0 auto",padding:"20px 16px"}}>
          <button onClick={() => setView("dashboard")} style={{...btn("#f3f4f6","#374151"),marginBottom:16}}>← Back</button>
          <div style={card}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
              <div style={{width:16,height:16,borderRadius:"50%",background:cat.color}}/>
              <h2 style={{margin:0,fontSize:20}}>{cat.name}</h2>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:14,color:"#6b7280",marginBottom:6}}>
              <span>{fmt(spent)} spent</span><span>{fmt(cat.budget)} budget</span>
            </div>
            <div style={{height:10,background:"#f3f4f6",borderRadius:99,overflow:"hidden",marginBottom:8}}>
              <div style={{height:"100%",width:`${pct}%`,background:pct>=100?"#ef4444":cat.color,borderRadius:99,transition:"width .4s"}}/>
            </div>
            <div style={{fontSize:14,color:spent>cat.budget?"#ef4444":"#10b981",fontWeight:600}}>
              {spent>cat.budget?`${fmt(spent-cat.budget)} over budget`:`${fmt(cat.budget-spent)} remaining`}
            </div>
          </div>
          <div style={card}>
            <h3 style={{margin:"0 0 16px",fontSize:16}}>Expenses — {MONTHS[month]} {year}</h3>
            {catExps.length===0 ? <p style={{color:"#9ca3af",fontSize:14,margin:0}}>No expenses logged this month.</p>
            : catExps.map(e => (
              <div key={e.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid #f3f4f6"}}>
                <div>
                  <div style={{fontWeight:600,fontSize:15}}>{fmt(e.amount)}</div>
                  <div style={{fontSize:13,color:"#6b7280"}}>{e.note||"—"} · {e.date}</div>
                </div>
                <button onClick={() => deleteExpense(e.id)} style={{...btn("#fee2e2","#ef4444"),padding:"4px 10px",fontSize:13}}>✕</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Settings ──
  if (view === "settings") {
    return (
      <div style={base}>
        <div style={{maxWidth:600,margin:"0 auto",padding:"20px 16px"}}>
          <button onClick={() => setView("dashboard")} style={{...btn("#f3f4f6","#374151"),marginBottom:16}}>← Back</button>
          <div style={card}>
            <h3 style={{margin:"0 0 16px",fontSize:16}}>Monthly Income</h3>
            {editIncome ? (
              <div style={{display:"flex",gap:8}}>
                <input style={{...inp,width:160}} type="number" value={incomeInput} onChange={e=>setIncomeInput(e.target.value)}/>
                <button style={btn()} onClick={saveIncome}>Save</button>
                <button style={btn("#f3f4f6","#374151")} onClick={()=>setEditIncome(false)}>Cancel</button>
              </div>
            ) : (
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <span style={{fontSize:18,fontWeight:700}}>{fmt(income)}</span>
                <button style={btn("#f3f4f6","#374151")} onClick={()=>setEditIncome(true)}>Edit</button>
              </div>
            )}
          </div>
          <div style={card}>
            <h3 style={{margin:"0 0 16px",fontSize:16}}>Categories</h3>
            {categories.map(c => (
              <div key={c.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #f3f4f6"}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{position:"relative",width:24,height:24}}>
                    <div style={{width:24,height:24,borderRadius:"50%",background:c.color,cursor:"pointer",border:"2px solid #e5e7eb"}}/>
                    <input type="color" value={c.color} onChange={e=>updateCategoryColor(c.id,e.target.value)}
                      style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",opacity:0,cursor:"pointer",borderRadius:"50%"}}/>
                  </div>
                  <span style={{fontWeight:500}}>{c.name}</span>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{color:"#6b7280",fontSize:14}}>{fmt(c.budget)}/mo</span>
                  <button onClick={()=>deleteCategory(c.id)} style={{...btn("#fee2e2","#ef4444"),padding:"3px 9px",fontSize:12}}>✕</button>
                </div>
              </div>
            ))}
            <div style={{display:"flex",gap:8,marginTop:16,flexWrap:"wrap"}}>
              <input style={{...inp,width:130,flex:1}} placeholder="Category name" value={newCat.name} onChange={e=>setNewCat(n=>({...n,name:e.target.value}))}/>
              <input style={{...inp,width:100,flex:"0 0 100px"}} placeholder="Budget $" type="number" value={newCat.budget} onChange={e=>setNewCat(n=>({...n,budget:e.target.value}))}/>
              <input type="color" value={newCat.color||COLORS[categories.length%COLORS.length]} onChange={e=>setNewCat(n=>({...n,color:e.target.value}))}
                style={{width:36,height:36,borderRadius:8,border:"1.5px solid #e5e7eb",cursor:"pointer",padding:2}}/>
              <button style={btn()} onClick={addCategory}>Add</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Dashboard ──
  return (
    <div style={base}>
      <div style={{maxWidth:640,margin:"0 auto",padding:"20px 16px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
          <div>
            <h1 style={{margin:0,fontSize:22,fontWeight:800}}>💰 Budget Tracker</h1>
            {saveStatus && <span style={{fontSize:12,color:"#10b981"}}>{saveStatus}</span>}
          </div>
          <button style={btn("#f3f4f6","#374151")} onClick={()=>setView("settings")}>⚙ Settings</button>
        </div>

        <div style={{...card,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 20px"}}>
          <button onClick={prevMonth} style={{...btn("#f3f4f6","#374151"),padding:"6px 12px"}}>‹</button>
          <span style={{fontWeight:700,fontSize:17}}>{MONTHS[month]} {year}</span>
          <button onClick={nextMonth} style={{...btn("#f3f4f6","#374151"),padding:"6px 12px"}}>›</button>
        </div>

        <div style={{...card,display:"flex",alignItems:"center",gap:24,flexWrap:"wrap"}}>
          <DonutChart/>
          <div style={{flex:1,minWidth:160}}>
            <div style={{marginBottom:12}}>
              <div style={{fontSize:12,color:"#9ca3af",fontWeight:600,textTransform:"uppercase",letterSpacing:.5}}>Income</div>
              <div style={{fontSize:22,fontWeight:800}}>{fmt(income)}</div>
            </div>
            <div style={{display:"flex",gap:20,flexWrap:"wrap"}}>
              <div>
                <div style={{fontSize:12,color:"#9ca3af",fontWeight:600,textTransform:"uppercase",letterSpacing:.5}}>Spent</div>
                <div style={{fontSize:18,fontWeight:700,color:"#ef4444"}}>{fmt(totalSpent)}</div>
              </div>
              <div>
                <div style={{fontSize:12,color:"#9ca3af",fontWeight:600,textTransform:"uppercase",letterSpacing:.5}}>Remaining</div>
                <div style={{fontSize:18,fontWeight:700,color:totalRemaining<0?"#ef4444":"#10b981"}}>{fmt(totalRemaining)}</div>
              </div>
            </div>
            <div style={{marginTop:10,fontSize:13,color:"#9ca3af"}}>Total budgeted: {fmt(totalBudget)}</div>
          </div>
        </div>

        <div style={card}>
          <h3 style={{margin:"0 0 14px",fontSize:16}}>Categories</h3>
          {categories.map(c => {
            const spent = spentByCategory[c.id]||0;
            const pct = Math.min((spent/c.budget)*100,100);
            const over = spent>c.budget;
            return (
              <div key={c.id} style={{marginBottom:14,cursor:"pointer"}} onClick={()=>{setActiveCategory(c.id);setView("category");}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:14,marginBottom:4}}>
                  <span style={{display:"flex",alignItems:"center",gap:7,fontWeight:600}}>
                    <span style={{width:10,height:10,borderRadius:"50%",background:c.color,display:"inline-block"}}/>
                    {c.name}
                  </span>
                  <span style={{color:over?"#ef4444":"#6b7280"}}>{fmt(spent)} / {fmt(c.budget)}</span>
                </div>
                <div style={{height:8,background:"#f3f4f6",borderRadius:99,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${pct}%`,background:over?"#ef4444":c.color,borderRadius:99,transition:"width .4s"}}/>
                </div>
                {over && <div style={{fontSize:12,color:"#ef4444",marginTop:2}}>{fmt(spent-c.budget)} over budget</div>}
              </div>
            );
          })}
        </div>

        <div style={card}>
          <h3 style={{margin:"0 0 14px",fontSize:16}}>Add Expense</h3>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <input style={{...inp,flex:"1 1 80px",minWidth:80}} type="number" placeholder="Amount $" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))}/>
              <select style={{...inp,flex:"2 1 140px",minWidth:120}} value={form.categoryId} onChange={e=>setForm(f=>({...f,categoryId:e.target.value}))}>
                <option value="">Category</option>
                {categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <input style={{...inp,flex:"2 1 160px"}} placeholder="Note (optional)" value={form.note} onChange={e=>setForm(f=>({...f,note:e.target.value}))}/>
              <input style={{...inp,flex:"1 1 130px",minWidth:130}} type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/>
            </div>
            <button style={{...btn(),width:"100%",padding:"10px"}} onClick={addExpense}>+ Add Expense</button>
          </div>
        </div>

        <div style={card}>
          <h3 style={{margin:"0 0 14px",fontSize:16}}>Recent Expenses</h3>
          {monthExpenses.length===0 ? <p style={{color:"#9ca3af",fontSize:14,margin:0}}>No expenses logged this month.</p>
          : [...monthExpenses].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,8).map(e => {
            const cat = categories.find(c=>c.id===e.categoryId);
            return (
              <div key={e.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 0",borderBottom:"1px solid #f9fafb"}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:10,height:10,borderRadius:"50%",background:cat?.color||"#ccc",flexShrink:0}}/>
                  <div>
                    <div style={{fontWeight:600,fontSize:15}}>{fmt(e.amount)}</div>
                    <div style={{fontSize:12,color:"#9ca3af"}}>{cat?.name||"?"} · {e.note||"—"} · {e.date}</div>
                  </div>
                </div>
                <button onClick={()=>deleteExpense(e.id)} style={{...btn("#fee2e2","#ef4444"),padding:"4px 10px",fontSize:13}}>✕</button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}