import { useState, useEffect, useCallback, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";
import * as XLSX from "xlsx";

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

const PASSWORD = "MYPASSWORD";
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
const ordinal = n => { const s=["th","st","nd","rd"]; const v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); };

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
  const [recurringBills, setRecurringBills] = useState([]);
  const [view, setView] = useState("dashboard");
  const [activeCategory, setActiveCategory] = useState(null);
  const [form, setForm] = useState({ amount: "", categoryId: "", note: "", date: new Date().toISOString().split("T")[0] });
  const [newCat, setNewCat] = useState({ name: "", budget: "", color: COLORS[0] });
  const [incomeByMonth, setIncomeByMonth] = useState({});
  const [editingIncome, setEditingIncome] = useState(false);
  const [monthIncomeInput, setMonthIncomeInput] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [importRows, setImportRows] = useState([]);
  const [unmatchedQueue, setUnmatchedQueue] = useState([]);
  const [currentUnmatched, setCurrentUnmatched] = useState(null);
  const [importStatus, setImportStatus] = useState("");
  const [replaceOnImport, setReplaceOnImport] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [editingCatId, setEditingCatId] = useState(null);
  const [editCatForm, setEditCatForm] = useState({ name: "", budget: "" });
  const [newBill, setNewBill] = useState({ name: "", amount: "", dueDay: "", categoryId: "" });
  const [suggestions, setSuggestions] = useState([]);
  const fileRef = useRef();

  useEffect(() => {
    if (!authed) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "budget", "data"));
        if (snap.exists()) {
          const d = snap.data();
          if (d.categories) setCategories(d.categories);
          if (d.expenses) setExpenses(d.expenses);
          if (d.incomeByMonth) setIncomeByMonth(d.incomeByMonth);
          if (d.recurringBills) setRecurringBills(d.recurringBills);
        }
      } catch(e) { console.error(e); }
      setLoaded(true);
    })();
  }, [authed]);

  const save = useCallback(async (cats, exps, ibm, bills) => {
    try {
      await setDoc(doc(db, "budget", "data"), { categories: cats, expenses: exps, incomeByMonth: ibm, recurringBills: bills });
      setSaveStatus("Saved ✓");
      setTimeout(() => setSaveStatus(""), 2000);
    } catch(e) { setSaveStatus("Save failed"); }
  }, []);

  const mk = monthKey(year, month);
  const monthExpenses = expenses[mk] || [];
  const currentIncome = incomeByMonth[mk] || 0;
  const spentByCategory = categories.reduce((acc, c) => {
    acc[c.id] = monthExpenses.filter(e => e.categoryId === c.id).reduce((s, e) => s + Number(e.amount), 0);
    return acc;
  }, {});
  const totalBudget = categories.reduce((s, c) => s + Number(c.budget), 0);
  const totalSpent = Object.values(spentByCategory).reduce((s, v) => s + v, 0);
  const totalRemaining = currentIncome - totalSpent;

  const saveMonthIncome = () => {
    const v = Number(monthIncomeInput);
    if (!isNaN(v) && v >= 0) {
      const updated = { ...incomeByMonth, [mk]: v };
      setIncomeByMonth(updated);
      setEditingIncome(false);
      save(categories, expenses, updated, recurringBills);
    }
  };

  // ── Detect recurring bill suggestions ──
  useEffect(() => {
    if (!authed || !loaded) return;
    const descCount = {};
    Object.entries(expenses).forEach(([, exps]) => {
      const seen = new Set();
      exps.forEach(e => {
        const key = e.note?.toLowerCase().trim();
        if (!key || seen.has(key)) return;
        seen.add(key);
        if (!descCount[key]) descCount[key] = { count: 0, amounts: [], categoryId: e.categoryId, note: e.note };
        descCount[key].count++;
        descCount[key].amounts.push(Number(e.amount));
      });
    });
    const existing = recurringBills.map(b => b.name.toLowerCase().trim());
    const found = Object.values(descCount)
      .filter(d => d.count >= 3 && !existing.includes(d.note?.toLowerCase().trim()))
      .map(d => ({
        name: d.note,
        amount: Math.round((d.amounts.reduce((s,a) => s+a, 0) / d.amounts.length) * 100) / 100,
        categoryId: d.categoryId,
      }));
    setSuggestions(found);
  }, [authed, loaded, expenses, recurringBills]);

  // ── Check if a bill is paid this month ──
  const isBillPaid = (bill) => {
    return monthExpenses.some(e =>
      e.note?.toLowerCase().includes(bill.name.toLowerCase()) &&
      e.categoryId === bill.categoryId
    );
  };

  const addBill = () => {
    if (!newBill.name || !newBill.amount || !newBill.dueDay || !newBill.categoryId) return;
    const bill = { id: Date.now(), name: newBill.name, amount: Number(newBill.amount), dueDay: Number(newBill.dueDay), categoryId: Number(newBill.categoryId) };
    const updated = [...recurringBills, bill];
    setRecurringBills(updated);
    setNewBill({ name: "", amount: "", dueDay: "", categoryId: "" });
    save(categories, expenses, income, updated);
  };

  const deleteBill = (id) => {
    const updated = recurringBills.filter(b => b.id !== id);
    setRecurringBills(updated);
    save(categories, expenses, income, updated);
  };

  const addSuggestion = (s) => {
    const bill = { id: Date.now(), name: s.name, amount: s.amount, dueDay: 1, categoryId: s.categoryId };
    const updated = [...recurringBills, bill];
    setRecurringBills(updated);
    save(categories, expenses, income, updated);
  };

  const addExpense = () => {
    if (!form.amount || !form.categoryId || isNaN(Number(form.amount)) || Number(form.amount) <= 0) return;
    const newExp = { id: Date.now(), amount: Number(form.amount), categoryId: Number(form.categoryId), note: form.note, date: form.date };
    const updated = { ...expenses, [mk]: [...monthExpenses, newExp] };
    setExpenses(updated);
    setForm(f => ({ ...f, amount: "", note: "" }));
    save(categories, updated, incomeByMonth, recurringBills);
  };

  const deleteExpense = (id) => {
    const updated = { ...expenses, [mk]: monthExpenses.filter(e => e.id !== id) };
    setExpenses(updated);
    save(categories, updated, incomeByMonth, recurringBills);
  };

  const addCategory = () => {
    if (!newCat.name || !newCat.budget || isNaN(Number(newCat.budget))) return;
    const c = { id: Date.now(), name: newCat.name, budget: Number(newCat.budget), color: newCat.color || COLORS[categories.length % COLORS.length] };
    const updated = [...categories, c];
    setCategories(updated);
    setNewCat({ name: "", budget: "", color: COLORS[updated.length % COLORS.length] });
    save(updated, expenses, incomeByMonth, recurringBills);
  };

  const deleteCategory = (id) => {
    const updated = categories.filter(c => c.id !== id);
    setCategories(updated);
    save(updated, expenses, incomeByMonth, recurringBills);
  };

  const updateCategoryColor = (id, color) => {
    const updated = categories.map(c => c.id === id ? { ...c, color } : c);
    setCategories(updated);
    save(updated, expenses, incomeByMonth, recurringBills);
  };

  const updateCategoryDetails = (id, name, budget) => {
    if (!name || !budget || isNaN(Number(budget))) return;
    const updated = categories.map(c => c.id === id ? { ...c, name, budget: Number(budget) } : c);
    setCategories(updated);
    save(updated, expenses, incomeByMonth, recurringBills);
  };

  const saveIncome = () => {}; // kept for settings compatibility

  const saveIncome = () => {
    const v = Number(incomeInput);
    if (!isNaN(v) && v > 0) { setIncome(v); setEditIncome(false); save(categories, expenses, v, recurringBills); }
  };

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y-1); } else setMonth(m => m-1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y+1); } else setMonth(m => m+1); };

  const clearMonth = () => {
    const updated = { ...expenses };
    delete updated[mk];
    setExpenses(updated);
    save(categories, updated, income, recurringBills);
    setShowClearConfirm(false);
  };

  // ── Download template ──
  const downloadTemplate = () => {
    const catNames = categories.map(c => c.name);
    const wsData = [
      ["Date", "Amount", "Description", "Category"],
      ["30/06/2026", "45.50", "Woolworths", catNames[0] || ""],
      ["29/06/2026", "120.00", "Shell Petrol", catNames[0] || ""],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = [{ wch: 14 }, { wch: 12 }, { wch: 28 }, { wch: 18 }];
    const catList = catNames.join(",");
    ws["!dataValidation"] = [{ sqref: "D2:D1000", type: "list", formula1: `"${catList}"`, showDropDown: false, allowBlank: true }];
    const wsCats = XLSX.utils.aoa_to_sheet([["Categories"], ...catNames.map(n => [n])]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Import");
    XLSX.utils.book_append_sheet(wb, wsCats, "Categories");
    XLSX.writeFile(wb, "budget_import_template.xlsx");
  };

  const detectFormat = (headers) => {
    if (headers.includes("date") && headers.includes("amount") && headers.includes("description") && headers.includes("balance") && !headers.includes("category")) return "commbank";
    if (headers.includes("date") && headers.includes("amount") && headers.includes("category")) return "template";
    return "unknown";
  };

  const parseCSV = (text) => {
    const lines = text.trim().split("\n").filter(l => l.trim());
    const headers = lines[0].split(",").map(h => h.replace(/"/g, "").trim().toLowerCase());
    const format = detectFormat(headers);
    if (format === "unknown") return null;
    const dateIdx = headers.indexOf("date");
    const amountIdx = headers.indexOf("amount");
    const descIdx = headers.indexOf("description");
    const catIdx = headers.indexOf("category");
    const parseDate = (raw) => {
      if (!raw) return "";
      if (raw.includes("/")) { const [d,m,y] = raw.split("/"); return `${y.length===2?`20${y}`:y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`; }
      return raw;
    };
    const cleanDesc = (desc) => desc.replace(/\s+\d{4,}\s*/g, " ").trim();
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].match(/(".*?"|[^,]+)(?=,|$)/g) || [];
      const clean = cols.map(c => c.replace(/"/g, "").trim());
      const rawDate = clean[dateIdx] || "";
      const date = parseDate(rawDate);
      const rawAmount = clean[amountIdx] || "0";
      const amount = Math.abs(parseFloat(rawAmount.replace(/[^0-9.-]/g, "")));
      const desc = cleanDesc(clean[descIdx] || "");
      if (format === "commbank") {
        const catName = catIdx !== -1 ? (clean[catIdx] || "") : "";
        if (!catName || isNaN(amount) || amount <= 0 || parseFloat(rawAmount) > 0) continue;
        rows.push({ date, amount, note: desc, categoryName: catName });
      } else {
        const catName = clean[catIdx] || "";
        if (!catName || catName.startsWith("Available") || isNaN(amount) || amount <= 0) continue;
        rows.push({ date, amount, note: desc, categoryName: catName });
      }
    }
    return rows;
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const isExcel = file.name.endsWith(".xlsx") || file.name.endsWith(".xls");
    const processRows = (rows) => {
      if (!rows || rows.length === 0) { setImportStatus("Could not read file — check the format matches the template."); return; }
      const unmatched = [...new Set(rows.map(r => r.categoryName).filter(n => !categories.find(c => c.name.toLowerCase() === n.toLowerCase())))];
      setImportRows(rows);
      if (unmatched.length > 0) { setUnmatchedQueue(unmatched); setCurrentUnmatched({ name: unmatched[0], action: null, mapTo: "" }); }
      else commitImport(rows, {}, categories, expenses);
    };
    if (isExcel) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const wb = XLSX.read(ev.target.result, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
          const headers = (data[0] || []).map(h => String(h || "").trim().toLowerCase());
          const dateIdx = headers.indexOf("date"), amountIdx = headers.indexOf("amount"), descIdx = headers.indexOf("description"), catIdx = headers.indexOf("category");
          if (dateIdx===-1||amountIdx===-1||catIdx===-1) { setImportStatus("Could not read file."); return; }
          const rows = [];
          for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (!row||row.length===0) continue;
            const catName = String(row[catIdx]||"").trim();
            if (!catName) continue;
            let rawDate = String(row[dateIdx]||"").trim();
            let date = "";
            if (!isNaN(rawDate)&&rawDate.length>3) { const d=XLSX.SSF.parse_date_code(Number(rawDate)); if(d) date=`${d.y}-${String(d.m).padStart(2,"0")}-${String(d.d).padStart(2,"0")}`; }
            else if (rawDate.includes("/")) { const [d,m,y]=rawDate.split("/"); const fy=y.length===2?`20${y}`:y; date=`${fy}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`; }
            else if (rawDate.includes("-")) { const p=rawDate.split("-"); if(p[0].length===4){date=rawDate;}else{const[a,b,c]=p;date=`20${a}-${c.padStart(2,"0")}-${b.padStart(2,"0")}`;} }
            if (!date) continue;
            const amount = Math.abs(parseFloat(String(row[amountIdx]||"0").replace(/[^0-9.-]/g,"")));
            if (isNaN(amount)||amount<=0) continue;
            rows.push({ date, amount, note: String(row[descIdx]||"").trim(), categoryName: catName });
          }
          processRows(rows);
        } catch(err) { setImportStatus("Could not read file."); }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => { const rows = parseCSV(ev.target.result); processRows(rows); };
      reader.readAsText(file);
    }
    e.target.value = "";
  };

  const handleUnmatchedDecision = (action, mapTo) => {
    const resolved = { ...currentUnmatched, action, mapTo };
    const remaining = unmatchedQueue.slice(1);
    const resolutionMap = { [resolved.name]: resolved };
    if (remaining.length > 0) {
      setUnmatchedQueue(remaining);
      setCurrentUnmatched({ name: remaining[0], action: null, mapTo: "", _resolutions: { ...(currentUnmatched?._resolutions||{}), ...resolutionMap } });
    } else {
      const allResolutions = { ...(currentUnmatched?._resolutions||{}), ...resolutionMap };
      let updatedCats = [...categories];
      Object.values(allResolutions).forEach(r => { if(r.action==="create") updatedCats=[...updatedCats,{id:Date.now()+Math.random(),name:r.name,budget:200,color:COLORS[updatedCats.length%COLORS.length]}]; });
      setUnmatchedQueue([]);
      setCurrentUnmatched(null);
      commitImport(importRows, allResolutions, updatedCats, expenses);
      if (updatedCats.length!==categories.length) setCategories(updatedCats);
    }
  };

  const commitImport = (rows, resolutions, cats, exps) => {
    const newExps = { ...exps };
    if (replaceOnImport) {
      const affected = [...new Set(rows.map(r => { const d=new Date(r.date); return monthKey(d.getFullYear(),d.getMonth()); }))];
      affected.forEach(mk => { newExps[mk]=[]; });
    }
    let added = 0;
    rows.forEach(row => {
      let catName = row.categoryName;
      const res = resolutions[catName];
      if (res) { if(res.action==="skip") return; if(res.action==="remap") catName=res.mapTo; if(res.action==="create") catName=res.name; }
      const cat = cats.find(c => c.name.toLowerCase()===catName.toLowerCase());
      if (!cat) return;
      const d = new Date(row.date);
      const mk = monthKey(d.getFullYear(),d.getMonth());
      if (!newExps[mk]) newExps[mk]=[];
      newExps[mk].push({ id:Date.now()+Math.random(), amount:row.amount, categoryId:cat.id, note:row.note, date:row.date });
      added++;
    });
    setExpenses(newExps);
    save(cats, newExps, income, recurringBills);
    setImportStatus(`✓ ${added} transaction${added!==1?"s":""} imported successfully!`);
    setTimeout(()=>setImportStatus(""),4000);
  };

  const DonutChart = () => {
    const r=80,cx=107,cy=107,circ=2*Math.PI*r;
    let offset=0;
    const slices=totalSpent>0?categories.map(c=>{const pct=spentByCategory[c.id]/totalSpent;const dash=pct*circ;const s={color:c.color,dash,offset};offset+=dash;return s;}):[]; 
    return (
      <svg width="214" height="214" viewBox="0 0 214 214">
        {totalSpent===0?<circle cx={cx} cy={cy} r={r} fill="none" stroke="#e5e7eb" strokeWidth="26"/>
        :slices.map((s,i)=>(<circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth="26" strokeDasharray={`${s.dash} ${circ-s.dash}`} strokeDashoffset={-s.offset+circ*0.25} style={{transform:"rotate(-90deg)",transformOrigin:`${cx}px ${cy}px`}}/>))}
        <text x={cx} y={cy-10} textAnchor="middle" fontSize="13" fill="#6b7280">Spent</text>
        <text x={cx} y={cy+12} textAnchor="middle" fontSize="17" fontWeight="700" fill="#111827">{fmt(totalSpent)}</text>
      </svg>
    );
  };

  const base={fontFamily:"'Inter',system-ui,sans-serif",minHeight:"100vh",background:"#f9fafb",color:"#111827"};
  const card={background:"#fff",borderRadius:12,padding:20,boxShadow:"0 1px 4px rgba(0,0,0,0.08)",marginBottom:16};
  const btn=(bg="#6366f1",color="#fff")=>({background:bg,color,border:"none",borderRadius:8,padding:"8px 16px",cursor:"pointer",fontSize:14,fontWeight:600});
  const inp={border:"1.5px solid #e5e7eb",borderRadius:8,padding:"8px 12px",fontSize:14,outline:"none",width:"100%",boxSizing:"border-box"};

  if (!authed) return (
    <div style={{...base,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{...card,width:300,textAlign:"center"}}>
        <div style={{fontSize:32,marginBottom:8}}>💰</div>
        <h2 style={{margin:"0 0 20px",fontSize:20}}>Budget Tracker</h2>
        <input style={{...inp,marginBottom:10,textAlign:"center",letterSpacing:2}} type="password" placeholder="Enter password" value={pwInput} onChange={e=>{setPwInput(e.target.value);setPwError(false);}} onKeyDown={e=>{if(e.key==="Enter"){if(pwInput===PASSWORD)setAuthed(true);else setPwError(true);}}}/>
        {pwError&&<div style={{color:"#ef4444",fontSize:13,marginBottom:8}}>Incorrect password</div>}
        <button style={{...btn(),width:"100%",padding:10}} onClick={()=>{if(pwInput===PASSWORD)setAuthed(true);else setPwError(true);}}>Unlock</button>
      </div>
    </div>
  );

  if (!loaded) return <div style={{...base,display:"flex",alignItems:"center",justifyContent:"center",color:"#6b7280"}}>Loading...</div>;

  if (currentUnmatched?.action===null) return (
    <div style={{...base,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{...card,maxWidth:420,width:"100%"}}>
        <h3 style={{margin:"0 0 8px",fontSize:18}}>Unknown Category</h3>
        <p style={{color:"#6b7280",fontSize:14,margin:"0 0 20px"}}>The category <strong>"{currentUnmatched.name}"</strong> wasn't found. What would you like to do?</p>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <button style={{...btn("#10b981"),textAlign:"left",padding:"12px 16px"}} onClick={()=>handleUnmatchedDecision("create",currentUnmatched.name)}>✨ Create "{currentUnmatched.name}" as a new category</button>
          <div style={{border:"1.5px solid #e5e7eb",borderRadius:8,padding:12}}>
            <div style={{fontSize:13,color:"#6b7280",marginBottom:8}}>Map to an existing category:</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{categories.map(c=>(<button key={c.id} style={{...btn("#f3f4f6","#374151"),padding:"6px 12px",fontSize:13}} onClick={()=>handleUnmatchedDecision("remap",c.name)}>{c.name}</button>))}</div>
          </div>
          <button style={{...btn("#fee2e2","#ef4444"),textAlign:"left",padding:"12px 16px"}} onClick={()=>handleUnmatchedDecision("skip","")}>✕ Skip all "{currentUnmatched.name}" transactions</button>
        </div>
        <div style={{fontSize:13,color:"#9ca3af",marginTop:12}}>{unmatchedQueue.length} unmatched categor{unmatchedQueue.length!==1?"ies":"y"} remaining</div>
      </div>
    </div>
  );

  // ── Recurring Bills view ──
  if (view === "bills") {
    const unpaid = recurringBills.filter(b => !isBillPaid(b));
    const paid = recurringBills.filter(b => isBillPaid(b));
    const totalUpcoming = unpaid.reduce((s,b) => s+b.amount, 0);
    return (
      <div style={base}>
        <div style={{maxWidth:600,margin:"0 auto",padding:"20px 16px"}}>
          <button onClick={()=>setView("dashboard")} style={{...btn("#f3f4f6","#374151"),marginBottom:16}}>← Back</button>
          <h2 style={{margin:"0 0 16px",fontSize:20,fontWeight:800}}>🔁 Recurring Bills — {MONTHS[month]} {year}</h2>

          {/* Summary */}
          <div style={{...card,display:"flex",gap:20}}>
            <div>
              <div style={{fontSize:12,color:"#9ca3af",fontWeight:600,textTransform:"uppercase"}}>Upcoming</div>
              <div style={{fontSize:20,fontWeight:800,color:"#ef4444"}}>{fmt(totalUpcoming)}</div>
            </div>
            <div>
              <div style={{fontSize:12,color:"#9ca3af",fontWeight:600,textTransform:"uppercase"}}>Bills</div>
              <div style={{fontSize:20,fontWeight:800}}>{recurringBills.length}</div>
            </div>
            <div>
              <div style={{fontSize:12,color:"#9ca3af",fontWeight:600,textTransform:"uppercase"}}>Paid</div>
              <div style={{fontSize:20,fontWeight:800,color:"#10b981"}}>{paid.length}/{recurringBills.length}</div>
            </div>
          </div>

          {/* Upcoming bills */}
          {unpaid.length > 0 && (
            <div style={card}>
              <h3 style={{margin:"0 0 14px",fontSize:16}}>⏳ Upcoming</h3>
              {unpaid.sort((a,b)=>a.dueDay-b.dueDay).map(b => {
                const cat = categories.find(c=>c.id===b.categoryId);
                return (
                  <div key={b.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid #f3f4f6"}}>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{width:10,height:10,borderRadius:"50%",background:cat?.color||"#ccc",flexShrink:0}}/>
                      <div>
                        <div style={{fontWeight:600,fontSize:15}}>{b.name}</div>
                        <div style={{fontSize:12,color:"#9ca3af"}}>Due {ordinal(b.dueDay)} · {cat?.name||"?"}</div>
                      </div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontWeight:700,color:"#ef4444"}}>{fmt(b.amount)}</span>
                      <button onClick={()=>deleteBill(b.id)} style={{...btn("#fee2e2","#ef4444"),padding:"3px 9px",fontSize:12}}>✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Paid bills */}
          {paid.length > 0 && (
            <div style={card}>
              <h3 style={{margin:"0 0 14px",fontSize:16}}>✅ Paid this month</h3>
              {paid.map(b => {
                const cat = categories.find(c=>c.id===b.categoryId);
                return (
                  <div key={b.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid #f3f4f6",opacity:0.6}}>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{width:10,height:10,borderRadius:"50%",background:cat?.color||"#ccc",flexShrink:0}}/>
                      <div>
                        <div style={{fontWeight:600,fontSize:15}}>{b.name}</div>
                        <div style={{fontSize:12,color:"#9ca3af"}}>Due {ordinal(b.dueDay)} · {cat?.name||"?"}</div>
                      </div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontWeight:700,color:"#10b981"}}>{fmt(b.amount)}</span>
                      <button onClick={()=>deleteBill(b.id)} style={{...btn("#fee2e2","#ef4444"),padding:"3px 9px",fontSize:12}}>✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Auto-detected suggestions */}
          {suggestions.length > 0 && (
            <div style={card}>
              <h3 style={{margin:"0 0 6px",fontSize:16}}>💡 Suggested recurring bills</h3>
              <p style={{fontSize:13,color:"#6b7280",margin:"0 0 14px"}}>These appear regularly in your transaction history:</p>
              {suggestions.map((s,i) => {
                const cat = categories.find(c=>c.id===s.categoryId);
                return (
                  <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid #f3f4f6"}}>
                    <div>
                      <div style={{fontWeight:600,fontSize:15}}>{s.name}</div>
                      <div style={{fontSize:12,color:"#9ca3af"}}>Avg {fmt(s.amount)} · {cat?.name||"?"}</div>
                    </div>
                    <button style={{...btn("#10b981"),padding:"6px 12px",fontSize:13}} onClick={()=>addSuggestion(s)}>+ Add</button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add bill manually */}
          <div style={card}>
            <h3 style={{margin:"0 0 14px",fontSize:16}}>Add Recurring Bill</h3>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <input style={inp} placeholder="Bill name (e.g. Netflix)" value={newBill.name} onChange={e=>setNewBill(b=>({...b,name:e.target.value}))}/>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <input style={{...inp,flex:"1 1 80px"}} type="number" placeholder="Amount $" value={newBill.amount} onChange={e=>setNewBill(b=>({...b,amount:e.target.value}))}/>
                <input style={{...inp,flex:"1 1 80px"}} type="number" placeholder="Due day (1-31)" min="1" max="31" value={newBill.dueDay} onChange={e=>setNewBill(b=>({...b,dueDay:e.target.value}))}/>
              </div>
              <select style={inp} value={newBill.categoryId} onChange={e=>setNewBill(b=>({...b,categoryId:e.target.value}))}>
                <option value="">Select category</option>
                {categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button style={{...btn(),width:"100%",padding:"10px"}} onClick={addBill}>+ Add Bill</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view==="category"&&activeCategory) {
    const cat=categories.find(c=>c.id===activeCategory);
    const catExps=monthExpenses.filter(e=>e.categoryId===activeCategory).sort((a,b)=>new Date(b.date)-new Date(a.date));
    const spent=spentByCategory[activeCategory]||0;
    const pct=Math.min((spent/cat.budget)*100,100);
    return (
      <div style={base}>
        <div style={{maxWidth:600,margin:"0 auto",padding:"20px 16px"}}>
          <button onClick={()=>setView("dashboard")} style={{...btn("#f3f4f6","#374151"),marginBottom:16}}>← Back</button>
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
            {catExps.length===0?<p style={{color:"#9ca3af",fontSize:14,margin:0}}>No expenses logged this month.</p>
            :catExps.map(e=>(
              <div key={e.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid #f3f4f6"}}>
                <div>
                  <div style={{fontWeight:600,fontSize:15}}>{fmt(e.amount)}</div>
                  <div style={{fontSize:13,color:"#6b7280"}}>{e.note||"—"} · {e.date}</div>
                </div>
                <button onClick={()=>deleteExpense(e.id)} style={{...btn("#fee2e2","#ef4444"),padding:"4px 10px",fontSize:13}}>✕</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (view==="settings") return (
    <div style={base}>
      <div style={{maxWidth:600,margin:"0 auto",padding:"20px 16px"}}>
        <button onClick={()=>setView("dashboard")} style={{...btn("#f3f4f6","#374151"),marginBottom:16}}>← Back</button>
        <div style={card}>
          <h3 style={{margin:"0 0 16px",fontSize:16}}>Categories</h3>
          {categories.map(c=>(
            <div key={c.id} style={{padding:"8px 0",borderBottom:"1px solid #f3f4f6"}}>
              {editingCatId===c.id?(
                <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                  <div style={{position:"relative",width:24,height:24,flexShrink:0}}>
                    <div style={{width:24,height:24,borderRadius:"50%",background:c.color,cursor:"pointer",border:"2px solid #e5e7eb"}}/>
                    <input type="color" value={c.color} onChange={e=>updateCategoryColor(c.id,e.target.value)} style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",opacity:0,cursor:"pointer"}}/>
                  </div>
                  <input style={{...inp,flex:"1 1 100px",minWidth:90}} value={editCatForm.name} onChange={e=>setEditCatForm(f=>({...f,name:e.target.value}))}/>
                  <input style={{...inp,flex:"0 0 90px",width:90}} type="number" value={editCatForm.budget} onChange={e=>setEditCatForm(f=>({...f,budget:e.target.value}))}/>
                  <button style={{...btn("#10b981"),padding:"6px 12px",fontSize:13}} onClick={()=>{updateCategoryDetails(c.id,editCatForm.name,editCatForm.budget);setEditingCatId(null);}}>Save</button>
                  <button style={{...btn("#f3f4f6","#374151"),padding:"6px 12px",fontSize:13}} onClick={()=>setEditingCatId(null)}>Cancel</button>
                </div>
              ):(
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}} onClick={()=>{setEditingCatId(c.id);setEditCatForm({name:c.name,budget:c.budget});}}>
                    <div style={{width:12,height:12,borderRadius:"50%",background:c.color}}/>
                    <span style={{fontWeight:500}}>{c.name}</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{color:"#6b7280",fontSize:14}}>{fmt(c.budget)}/mo</span>
                    <button onClick={()=>{setEditingCatId(c.id);setEditCatForm({name:c.name,budget:c.budget});}} style={{...btn("#f3f4f6","#374151"),padding:"3px 9px",fontSize:12}}>✎</button>
                    <button onClick={()=>deleteCategory(c.id)} style={{...btn("#fee2e2","#ef4444"),padding:"3px 9px",fontSize:12}}>✕</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          <div style={{display:"flex",gap:8,marginTop:16,flexWrap:"wrap"}}>
            <input style={{...inp,width:130,flex:1}} placeholder="Category name" value={newCat.name} onChange={e=>setNewCat(n=>({...n,name:e.target.value}))}/>
            <input style={{...inp,width:100,flex:"0 0 100px"}} placeholder="Budget $" type="number" value={newCat.budget} onChange={e=>setNewCat(n=>({...n,budget:e.target.value}))}/>
            <input type="color" value={newCat.color} onChange={e=>setNewCat(n=>({...n,color:e.target.value}))} style={{width:36,height:36,borderRadius:8,border:"1.5px solid #e5e7eb",cursor:"pointer",padding:2}}/>
            <button style={btn()} onClick={addCategory}>Add</button>
          </div>
        </div>
        <div style={card}>
          <h3 style={{margin:"0 0 8px",fontSize:16}}>Import from Excel</h3>
          <p style={{fontSize:13,color:"#6b7280",margin:"0 0 14px"}}>Download the template, fill it in, then upload it here.</p>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,cursor:"pointer"}} onClick={()=>setReplaceOnImport(r=>!r)}>
            <div style={{width:20,height:20,borderRadius:4,border:"2px solid #6366f1",background:replaceOnImport?"#6366f1":"#fff",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              {replaceOnImport&&<span style={{color:"#fff",fontSize:14,lineHeight:1}}>✓</span>}
            </div>
            <span style={{fontSize:14,color:"#374151"}}>Replace existing expenses for imported months</span>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button style={btn("#f3f4f6","#374151")} onClick={downloadTemplate}>⬇ Download Template</button>
            <button style={btn()} onClick={()=>fileRef.current.click()}>⬆ Upload File</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{display:"none"}} onChange={handleFileUpload}/>
          </div>
          {importStatus&&<div style={{marginTop:12,fontSize:14,color:importStatus.startsWith("✓")?"#10b981":"#ef4444",fontWeight:600}}>{importStatus}</div>}
        </div>
      </div>
    </div>
  );

  // ── Dashboard ──
  const unpaidCount = recurringBills.filter(b=>!isBillPaid(b)).length;
  return (
    <div style={base}>
      <div style={{maxWidth:640,margin:"0 auto",padding:"20px 16px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
          <div>
            <h1 style={{margin:0,fontSize:22,fontWeight:800}}>💰 Budget Tracker</h1>
            {saveStatus&&<span style={{fontSize:12,color:"#10b981"}}>{saveStatus}</span>}
          </div>
          <div style={{display:"flex",gap:8}}>
            <button style={{...btn("#f3f4f6","#374151"),position:"relative"}} onClick={()=>setView("bills")}>
              🔁 Bills
              {unpaidCount>0&&<span style={{position:"absolute",top:-6,right:-6,background:"#ef4444",color:"#fff",borderRadius:"50%",width:18,height:18,fontSize:11,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>{unpaidCount}</span>}
            </button>
            <button style={btn("#f3f4f6","#374151")} onClick={()=>setView("settings")}>⚙ Settings</button>
          </div>
        </div>

        <div style={{...card,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 20px"}}>
          <button onClick={prevMonth} style={{...btn("#f3f4f6","#374151"),padding:"6px 12px"}}>‹</button>
          <span style={{fontWeight:700,fontSize:17}}>{MONTHS[month]} {year}</span>
          <button onClick={nextMonth} style={{...btn("#f3f4f6","#374151"),padding:"6px 12px"}}>›</button>
        </div>

        {showClearConfirm?(
          <div style={{...card,background:"#fff5f5",border:"1.5px solid #fee2e2"}}>
            <p style={{margin:"0 0 12px",fontSize:14,color:"#374151"}}>Are you sure you want to clear all expenses for <strong>{MONTHS[month]} {year}</strong>? This cannot be undone.</p>
            <div style={{display:"flex",gap:8}}>
              <button style={{...btn("#ef4444"),padding:"8px 16px"}} onClick={clearMonth}>Yes, clear month</button>
              <button style={btn("#f3f4f6","#374151")} onClick={()=>setShowClearConfirm(false)}>Cancel</button>
            </div>
          </div>
        ):monthExpenses.length>0&&(
          <div style={{textAlign:"right",marginBottom:8}}>
            <button style={{...btn("#fee2e2","#ef4444"),fontSize:13,padding:"6px 12px"}} onClick={()=>setShowClearConfirm(true)}>🗑 Clear {MONTHS[month]}</button>
          </div>
        )}

        <div style={{...card,display:"flex",alignItems:"center",gap:24,flexWrap:"wrap"}}>
          <DonutChart/>
          <div style={{flex:1,minWidth:160}}>
            <div style={{marginBottom:12}}>
              <div style={{fontSize:12,color:"#9ca3af",fontWeight:600,textTransform:"uppercase",letterSpacing:.5}}>Income — {MONTHS[month]}</div>
              {editingIncome ? (
                <div style={{display:"flex",gap:8,alignItems:"center",marginTop:4}}>
                  <input style={{...inp,width:130}} type="number" placeholder="Enter income" value={monthIncomeInput} onChange={e=>setMonthIncomeInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&saveMonthIncome()}/>
                  <button style={{...btn("#10b981"),padding:"6px 12px",fontSize:13}} onClick={saveMonthIncome}>Save</button>
                  <button style={{...btn("#f3f4f6","#374151"),padding:"6px 12px",fontSize:13}} onClick={()=>setEditingIncome(false)}>✕</button>
                </div>
              ) : (
                <div style={{display:"flex",alignItems:"center",gap:10,marginTop:4}}>
                  <span style={{fontSize:22,fontWeight:800}}>{currentIncome>0?fmt(currentIncome):"Not set"}</span>
                  <button style={{...btn("#f3f4f6","#374151"),padding:"3px 9px",fontSize:12}} onClick={()=>{setMonthIncomeInput(currentIncome||"");setEditingIncome(true);}}>✎</button>
                </div>
              )}
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
          {categories.map(c=>{
            const spent=spentByCategory[c.id]||0;
            const pct=Math.min((spent/c.budget)*100,100);
            const over=spent>c.budget;
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
                {over&&<div style={{fontSize:12,color:"#ef4444",marginTop:2}}>{fmt(spent-c.budget)} over budget</div>}
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
          {monthExpenses.length===0?<p style={{color:"#9ca3af",fontSize:14,margin:0}}>No expenses logged this month.</p>
          :[...monthExpenses].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,8).map(e=>{
            const cat=categories.find(c=>c.id===e.categoryId);
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
