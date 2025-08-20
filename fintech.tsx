import React, { useMemo, useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

// ------------------------------------------------------------
// FinMate – Zero-backend MVP (all local state)
// ------------------------------------------------------------
// This single-file prototype demonstrates the core flows:
// 1) Allowance GPS (run-out prediction) with modes Tight/Normal/Chill
// 2) Unified Wallet (mock UPI + cash + wallet)
// 3) Smart Buckets + Micro-savings Jars
// 4) Squad Finance (group expense & settlement suggestions)
// 5) Campus Calendar reserves
// 6) Buddy Bot (rule-based nudges)
// ------------------------------------------------------------

const CATEGORIES = ["Mess", "Outings", "Rent", "Utilities", "Travel", "Groceries", "Misc"] as const;
const CHANNELS = ["UPI", "Cash", "Wallet"] as const;

type Category = typeof CATEGORIES[number];
type Channel = typeof CHANNELS[number];

type Txn = {
  id: string;
  date: string; // ISO
  amount: number; // positive for spend, negative for top-ups/refunds
  category: Category;
  channel: Channel;
  note?: string;
};

type Jar = {
  key: string;
  name: string;
  target: number;
  saved: number;
};

type Group = {
  id: string;
  name: string;
  members: string[]; // simple names/emails
  txns: GroupTxn[];
};

type GroupTxn = {
  id: string;
  date: string;
  description: string;
  amount: number; // total amount
  paidBy: string; // member name
  splitWith: string[]; // members included in split (equal for MVP)
};

type EventItem = {
  id: string;
  name: string;
  date: string;
  expectedSpend: number;
  reserved: number; // transferred to Fest jar
};

// Utility
const uid = () => Math.random().toString(36).slice(2, 10);
const todayISO = () => new Date().toISOString().slice(0, 10);

const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};

const daysBetween = (a: Date, b: Date) => Math.ceil((b.getTime() - a.getTime()) / (1000 * 3600 * 24));

// ------------------------------------------------------------
// Allowance GPS – core forecasting
// ------------------------------------------------------------
function ewma(values: number[], alpha = 0.4) {
  if (values.length === 0) return 0;
  let s = values[0];
  for (let i = 1; i < values.length; i++) s = alpha * values[i] + (1 - alpha) * s;
  return s;
}

function predictRunOutDate({
  allowance,
  sideIncome,
  spendSoFar,
  dailySeries,
}: {
  allowance: number;
  sideIncome: number;
  spendSoFar: number;
  dailySeries: number[]; // spend per day from month start to today
}) {
  const balance = allowance + sideIncome - spendSoFar;
  const burn = ewma(dailySeries.filter((v) => v >= 0));
  if (burn <= 0) return { balance, burn: 0, daysLeft: Infinity, runoutDate: null as Date | null };
  const daysLeft = Math.max(0, Math.floor(balance / burn));
  const runoutDate = new Date();
  runoutDate.setDate(runoutDate.getDate() + daysLeft);
  return { balance, burn, daysLeft, runoutDate };
}

// ------------------------------------------------------------
// Minimum-cash settlement for Squad Finance
// ------------------------------------------------------------
function suggestSettlements(group: Group) {
  // Compute net per member
  const net: Record<string, number> = Object.fromEntries(group.members.map((m) => [m, 0]));
  for (const t of group.txns) {
    const share = t.amount / t.splitWith.length;
    for (const m of t.splitWith) net[m] -= share;
    net[t.paidBy] += t.amount;
  }
  const debtors: { m: string; amt: number }[] = [];
  const creditors: { m: string; amt: number }[] = [];
  for (const [m, v] of Object.entries(net)) {
    if (v < -0.5) debtors.push({ m, amt: -v });
    else if (v > 0.5) creditors.push({ m, amt: v });
  }
  debtors.sort((a, b) => b.amt - a.amt);
  creditors.sort((a, b) => b.amt - a.amt);
  const res: { from: string; to: string; amt: number }[] = [];
  let i = 0,
    j = 0;
  while (i < debtors.length && j < creditors.length) {
    const take = Math.min(debtors[i].amt, creditors[j].amt);
    res.push({ from: debtors[i].m, to: creditors[j].m, amt: Math.round(take) });
    debtors[i].amt -= take;
    creditors[j].amt -= take;
    if (debtors[i].amt < 1) i++;
    if (creditors[j].amt < 1) j++;
  }
  return res;
}

// ------------------------------------------------------------
// Main Component
// ------------------------------------------------------------
export default function FinMatePrototype() {
  // --- Onboarding-ish defaults ---
  const [monthAllowance, setMonthAllowance] = useState<number>(8000);
  const [sideIncome, setSideIncome] = useState<number>(0);
  const [mode, setMode] = useState<"Tight" | "Normal" | "Chill">("Normal");

  // Transactions
  const [txns, setTxns] = useState<Txn[]>([{
    id: uid(), date: todayISO(), amount: 120, category: "Mess", channel: "UPI", note: "Breakfast"},
    { id: uid(), date: todayISO(), amount: 300, category: "Outings", channel: "Wallet", note: "Cafe" },
    { id: uid(), date: todayISO(), amount: 4000, category: "Rent", channel: "UPI", note: "Hostel rent" },
  ]);

  // Jars (micro-savings)
  const [jars, setJars] = useState<Jar[]>([
    { key: "chai", name: "Chai Jar", target: 1000, saved: 50 },
    { key: "emergency", name: "Emergency", target: 3000, saved: 200 },
    { key: "fest", name: "Fest Fund", target: 1500, saved: 0 },
  ]);

  // Groups
  const [groups, setGroups] = useState<Group[]>([
    { id: uid(), name: "Room 108", members: ["You", "Aarav", "Sara"], txns: [] },
  ]);

  // Events
  const [events, setEvents] = useState<EventItem[]>([
    { id: uid(), name: "TechFest", date: todayISO(), expectedSpend: 800, reserved: 0 },
  ]);

  // Budgets by category + mode multipliers
  const baseBudgets: Record<Category, number> = {
    Mess: 2500,
    Outings: 1500,
    Rent: 4000,
    Utilities: 600,
    Travel: 600,
    Groceries: 800,
    Misc: 500,
  };
  const modeFactor = mode === "Tight" ? 0.75 : mode === "Chill" ? 1.15 : 1.0;
  const budgets = useMemo(() => {
    const b: Record<Category, number> = { ...baseBudgets };
    (Object.keys(b) as Category[]).forEach((k) => (b[k] = Math.round(b[k] * modeFactor)));
    return b;
  }, [mode]);

  const spendByCategory = useMemo(() => {
    const acc: Record<Category, number> = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as any;
    for (const t of txns) if (t.amount > 0) acc[t.category] += t.amount;
    return acc;
  }, [txns]);

  // Daily series from month start
  const dailySeries = useMemo(() => {
    const start = monthStart();
    const days = daysBetween(start, new Date());
    const arr = Array.from({ length: Math.max(1, days) }, () => 0);
    for (const t of txns) {
      const d = new Date(t.date);
      if (d >= start && t.amount > 0) {
        const idx = daysBetween(start, d) - 1;
        if (idx >= 0 && idx < arr.length) arr[idx] += t.amount;
      }
    }
    return arr;
  }, [txns]);

  const spendSoFar = useMemo(() => txns.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0), [txns]);
  const jarLocked = useMemo(() => jars.reduce((s, j) => s + j.saved, 0), [jars]);
  const { balance, burn, daysLeft, runoutDate } = useMemo(() => predictRunOutDate({
    allowance: monthAllowance,
    sideIncome,
    spendSoFar,
    dailySeries,
  }), [monthAllowance, sideIncome, spendSoFar, dailySeries]);

  // Buddy Bot rules (very simple, deterministic)
  const tips = useMemo(() => {
    const msgs: string[] = [];
    // Overspend check
    if (spendByCategory["Outings"] > budgets["Outings"]) msgs.push("Outings zyada ho gaya – Tight mode try karein? 🙈");
    // Run-out proximity
    if (daysLeft < 7) msgs.push("At this burn rate, paise khatam in <7 days. Micro-savings ON + cut Misc by 25%.");
    // Emergency jar low
    const em = jars.find((j) => j.key === "emergency");
    if (em && em.saved < 1000) msgs.push("Emergency jar thoda low hai. Har UPI pe ₹5 auto-save on karein?");
    if (msgs.length === 0) msgs.push("Aaj sab set! ☕️ Chai Jar me ₹5 daal du next spend pe?");
    return msgs;
  }, [spendByCategory, budgets, daysLeft, jars]);

  // Add transaction + micro-savings trigger
  function addTxn(partial: Omit<Txn, "id">) {
    const t: Txn = { id: uid(), ...partial };
    setTxns((x) => [t, ...x]);
    // Micro-savings: discretionary categories
    if (["Outings", "Misc", "Travel"].includes(t.category)) {
      setJars((js) => js.map((j) => (j.key === "chai" ? { ...j, saved: j.saved + 5 } : j)));
    }
  }

  function topUp(amount: number, note = "Side income") {
    // represent top-up as negative txn (reduces spendSoFar)
    addTxn({ amount: -amount, category: "Misc", channel: "UPI", date: todayISO(), note });
    setSideIncome((s) => s + amount);
  }

  // Squad helpers
  function addGroupTxn(gid: string, t: Omit<GroupTxn, "id">) {
    setGroups((gs) =>
      gs.map((g) => (g.id === gid ? { ...g, txns: [{ id: uid(), ...t }, ...g.txns] } : g))
    );
  }

  // Reserve for event into Fest jar
  function reserveForEvent(eid: string, amount: number) {
    setEvents((evs) => evs.map((e) => (e.id === eid ? { ...e, reserved: e.reserved + amount } : e)));
    setJars((js) => js.map((j) => (j.key === "fest" ? { ...j, saved: j.saved + amount } : j)));
  }

  // UI helpers
  const pct = (num: number, den: number) => (den <= 0 ? 0 : Math.min(100, Math.round((num / den) * 100)));

  // --- Render ---
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">FinMate – Student Finance MVP</h1>
        <div className="flex items-center gap-2">
          <Select value={mode} onValueChange={(v:any) => setMode(v)}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="Mode" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Tight">Tight</SelectItem>
              <SelectItem value="Normal">Normal</SelectItem>
              <SelectItem value="Chill">Chill</SelectItem>
            </SelectContent>
          </Select>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Top-up</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Side Income</DialogTitle></DialogHeader>
              <TopUpForm onSubmit={(amt, note) => topUp(amt, note)} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs defaultValue="dashboard" className="w-full">
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="txns">Transactions</TabsTrigger>
          <TabsTrigger value="jars">Jars</TabsTrigger>
          <TabsTrigger value="squads">Squads</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="buddy">Buddy</TabsTrigger>
        </TabsList>

        {/* DASHBOARD */}
        <TabsContent value="dashboard">
          <div className="grid md:grid-cols-3 gap-4">
            <Card className="col-span-1">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">Allowance GPS</h3>
                  <Badge>{mode}</Badge>
                </div>
                <div className="text-sm text-muted-foreground">Monthly Allowance</div>
                <div className="text-2xl">₹{monthAllowance.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Side Income</div>
                <div className="text-lg">₹{sideIncome.toLocaleString()}</div>
                <div className="text-sm mt-2">Spend so far: ₹{Math.max(0, spendSoFar).toLocaleString()}</div>
                <div className="text-sm">Locked in jars: ₹{jarLocked.toLocaleString()}</div>
                <div className="mt-2">
                  <Label>Predicted daily burn</Label>
                  <Progress value={Math.min(100, Math.round((burn / 500) * 100))} />
                  <div className="text-xs text-muted-foreground mt-1">₹{Math.round(burn)} / day</div>
                </div>
                <div className="text-sm mt-2">
                  {runoutDate ? (
                    <>Run-out in <b>{daysLeft}</b> days ({runoutDate.toDateString()})</>
                  ) : (
                    <>No run-out predicted</>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="col-span-1">
              <CardContent className="p-4 space-y-3">
                <h3 className="font-medium">Budgets vs Spend</h3>
                {CATEGORIES.map((c) => (
                  <div key={c} className="mb-2">
                    <div className="flex justify-between text-sm"><span>{c}</span><span>₹{spendByCategory[c]}/{budgets[c]}</span></div>
                    <Progress value={pct(spendByCategory[c], budgets[c])} />
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="col-span-1">
              <CardContent className="p-4 space-y-3">
                <h3 className="font-medium">Jars</h3>
                {jars.map((j) => (
                  <div key={j.key} className="mb-2">
                    <div className="flex justify-between text-sm"><span>{j.name}</span><span>₹{j.saved}/{j.target}</span></div>
                    <Progress value={pct(j.saved, j.target)} />
                  </div>
                ))}
                <Dialog>
                  <DialogTrigger asChild><Button className="w-full" variant="secondary">Create Jar</Button></DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>New Jar</DialogTitle></DialogHeader>
                    <NewJarForm onSubmit={(name, target) => setJars((js) => [...js, { key: uid(), name, target, saved: 0 }])} />
                  </DialogContent>
                </Dialog>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* TRANSACTIONS */}
        <TabsContent value="txns">
          <Card>
            <CardContent className="p-4 space-y-4">
              <h3 className="font-medium">Add Transaction</h3>
              <AddTxnForm onSubmit={addTxn} />
              <div className="mt-4 grid gap-2">
                {txns.map((t) => (
                  <div key={t.id} className="flex items-center justify-between p-2 rounded border">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline">{t.category}</Badge>
                      <div className="text-sm text-muted-foreground">{t.date}</div>
                      <div className="text-sm">{t.note}</div>
                    </div>
                    <div className={`font-medium ${t.amount > 0 ? "text-red-600" : "text-green-700"}`}>
                      {t.amount > 0 ? "-" : "+"}₹{Math.abs(t.amount)} <span className="text-xs text-muted-foreground">({t.channel})</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* JARS */}
        <TabsContent value="jars">
          <Card>
            <CardContent className="p-4 space-y-4">
              <h3 className="font-medium">Manage Jars</h3>
              <div className="grid md:grid-cols-3 gap-3">
                {jars.map((j) => (
                  <Card key={j.key} className="p-4">
                    <div className="flex justify-between">
                      <div>
                        <div className="font-medium">{j.name}</div>
                        <div className="text-xs text-muted-foreground">Target ₹{j.target}</div>
                      </div>
                      <div className="text-sm">₹{j.saved}</div>
                    </div>
                    <Progress className="mt-2" value={pct(j.saved, j.target)} />
                    <div className="flex gap-2 mt-3">
                      <Button size="sm" variant="outline" onClick={() => setJars((js) => js.map((x) => x.key === j.key ? { ...x, saved: x.saved + 50 } : x))}>+ ₹50</Button>
                      <Button size="sm" variant="outline" onClick={() => setJars((js) => js.map((x) => x.key === j.key ? { ...x, saved: Math.max(0, x.saved - 50) } : x))}>- ₹50</Button>
                    </div>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SQUADS */}
        <TabsContent value="squads">
          <div className="grid gap-4">
            {groups.map((g) => (
              <Card key={g.id}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{g.name} <span className="text-xs text-muted-foreground">({g.members.join(", ")})</span></div>
                    <Dialog>
                      <DialogTrigger asChild><Button size="sm">Add Group Expense</Button></DialogTrigger>
                      <DialogContent>
                        <DialogHeader><DialogTitle>New Group Expense</DialogTitle></DialogHeader>
                        <AddGroupTxnForm members={g.members} onSubmit={(t) => addGroupTxn(g.id, t)} />
                      </DialogContent>
                    </Dialog>
                  </div>
                  <div className="space-y-2">
                    {g.txns.map((t) => (
                      <div key={t.id} className="flex items-center justify-between p-2 rounded border">
                        <div className="text-sm">{t.date} • {t.description} • Paid by <b>{t.paidBy}</b></div>
                        <div className="text-sm">₹{t.amount} split with {t.splitWith.length}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2">
                    <h4 className="font-medium mb-2">Suggested Settlements</h4>
                    <div className="space-y-2">
                      {suggestSettlements(g).length === 0 ? (
                        <div className="text-sm text-muted-foreground">All settled 🎉</div>
                      ) : (
                        suggestSettlements(g).map((s, idx) => (
                          <div key={idx} className="text-sm">{s.from} → {s.to}: ₹{s.amt}</div>
                        ))
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            <Dialog>
              <DialogTrigger asChild><Button variant="secondary">Create Squad</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New Squad</DialogTitle></DialogHeader>
                <NewSquadForm onSubmit={(name, members) => setGroups((gs) => [...gs, { id: uid(), name, members, txns: [] }])} />
              </DialogContent>
            </Dialog>
          </div>
        </TabsContent>

        {/* CALENDAR */}
        <TabsContent value="calendar">
          <Card>
            <CardContent className="p-4 space-y-4">
              <h3 className="font-medium">Campus Calendar</h3>
              <div className="space-y-3">
                {events.map((e) => (
                  <div key={e.id} className="flex items-center justify-between p-2 rounded border">
                    <div>
                      <div className="font-medium">{e.name}</div>
                      <div className="text-xs text-muted-foreground">{e.date} • Expected ₹{e.expectedSpend} • Reserved ₹{e.reserved}</div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => reserveForEvent(e.id, 100)}>Reserve ₹100</Button>
                      <Button size="sm" variant="outline" onClick={() => reserveForEvent(e.id, 200)}>Reserve ₹200</Button>
                    </div>
                  </div>
                ))}
              </div>
              <Dialog>
                <DialogTrigger asChild><Button variant="secondary">Add Event</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>New Event</DialogTitle></DialogHeader>
                  <NewEventForm onSubmit={(name, date, expectedSpend) => setEvents((es) => [{ id: uid(), name, date, expectedSpend, reserved: 0 }, ...es])} />
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>
        </TabsContent>

        {/* BUDDY */}
        <TabsContent value="buddy">
          <Card>
            <CardContent className="p-4 space-y-3">
              <h3 className="font-medium">Buddy Bot</h3>
              <Alert>
                <AlertTitle>Nudges</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc ml-4">
                    {tips.map((t, i) => (
                      <li key={i} className="mt-1">{t}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
              <div className="text-xs text-muted-foreground">Rule-based for MVP; replace with LLM later.</div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ------------------- FORMS -------------------
function AddTxnForm({ onSubmit }: { onSubmit: (t: Omit<Txn, "id">) => void }) {
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(todayISO());
  const [category, setCategory] = useState<Category>("Mess");
  const [channel, setChannel] = useState<Channel>("UPI");
  const [note, setNote] = useState("");

  return (
    <div className="grid md:grid-cols-6 gap-2">
      <div className="col-span-1">
        <Label>Amount (₹)</Label>
        <Input type="number" value={amount} onChange={(e) => setAmount(parseInt(e.target.value || "0"))} />
      </div>
      <div className="col-span-1">
        <Label>Date</Label>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="col-span-1">
        <Label>Category</Label>
        <Select value={category} onValueChange={(v:any) => setCategory(v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>
      <div className="col-span-1">
        <Label>Channel</Label>
        <Select value={channel} onValueChange={(v:any) => setChannel(v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {CHANNELS.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>
      <div className="col-span-2">
        <Label>Note</Label>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g., Birthday treat" />
      </div>
      <div className="col-span-6 flex justify-end">
        <Button onClick={() => amount > 0 && onSubmit({ amount, date, category, channel, note })}>Add</Button>
      </div>
    </div>
  );
}

function NewJarForm({ onSubmit }: { onSubmit: (name: string, target: number) => void }) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState(1000);
  return (
    <div className="space-y-2">
      <Label>Jar Name</Label>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Goa Trip" />
      <Label>Target (₹)</Label>
      <Input type="number" value={target} onChange={(e) => setTarget(parseInt(e.target.value || "0"))} />
      <div className="flex justify-end">
        <Button onClick={() => name && target > 0 && onSubmit(name, target)}>Create</Button>
      </div>
    </div>
  );
}

function TopUpForm({ onSubmit }: { onSubmit: (amt: number, note: string) => void }) {
  const [amt, setAmt] = useState(1000);
  const [note, setNote] = useState("Part-time gig");
  return (
    <div className="space-y-2">
      <Label>Amount (₹)</Label>
      <Input type="number" value={amt} onChange={(e) => setAmt(parseInt(e.target.value || "0"))} />
      <Label>Note</Label>
      <Input value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex justify-end">
        <Button onClick={() => amt > 0 && onSubmit(amt, note)}>Add</Button>
      </div>
    </div>
  );
}

function AddGroupTxnForm({ members, onSubmit }: { members: string[]; onSubmit: (t: Omit<GroupTxn, "id">) => void }) {
  const [amount, setAmount] = useState(0);
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayISO());
  const [paidBy, setPaidBy] = useState(members[0] || "You");
  const [splitWith, setSplitWith] = useState<string[]>(members);

  return (
    <div className="space-y-2">
      <Label>Amount (₹)</Label>
      <Input type="number" value={amount} onChange={(e) => setAmount(parseInt(e.target.value || "0"))} />
      <Label>Description</Label>
      <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Pizza night" />
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label>Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <Label>Paid By</Label>
          <Select value={paidBy} onValueChange={(v:any) => setPaidBy(v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {members.map((m) => (<SelectItem key={m} value={m}>{m}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Split With</Label>
          <Textarea className="h-[80px]" value={splitWith.join(", ")} onChange={(e) => setSplitWith(e.target.value.split(",").map(s => s.trim()).filter(Boolean))} />
          <div className="text-xs text-muted-foreground mt-1">Comma-separated names</div>
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={() => amount > 0 && description && onSubmit({ amount, description, date, paidBy, splitWith })}>Add</Button>
      </div>
    </div>
  );
}

function NewSquadForm({ onSubmit }: { onSubmit: (name: string, members: string[]) => void }) {
  const [name, setName] = useState("");
  const [members, setMembers] = useState("You, Aarav, Sara");
  return (
    <div className="space-y-2">
      <Label>Squad Name</Label>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Hostel 108" />
      <Label>Members</Label>
      <Input value={members} onChange={(e) => setMembers(e.target.value)} />
      <div className="text-xs text-muted-foreground">Comma-separated names</div>
      <div className="flex justify-end">
        <Button onClick={() => name && onSubmit(name, members.split(",").map(s => s.trim()).filter(Boolean))}>Create</Button>
      </div>
    </div>
  );
}

function NewEventForm({ onSubmit }: { onSubmit: (name: string, date: string, expectedSpend: number) => void }) {
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayISO());
  const [expected, setExpected] = useState(500);
  return (
    <div className="space-y-2">
      <Label>Event Name</Label>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="College Fest" />
      <Label>Date</Label>
      <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <Label>Expected Spend (₹)</Label>
      <Input type="number" value={expected} onChange={(e) => setExpected(parseInt(e.target.value || "0"))} />
      <div className="flex justify-end">
        <Button onClick={() => name && expected > 0 && onSubmit(name, date, expected)}>Add</Button>
      </div>
    </div>
  );
}