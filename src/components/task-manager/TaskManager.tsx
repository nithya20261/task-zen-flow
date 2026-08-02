import { FormEvent, lazy, Suspense, useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, Clock3, Eye, EyeOff, Flame, LayoutDashboard, LogOut, Plus, Sparkles, Trash2, CalendarRange } from "lucide-react";
const Calendar = lazy(() => import("@/components/ui/calendar").then((m) => ({ default: m.Calendar })));
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

import type { Tables } from "@/integrations/supabase/types";

const authSchema = z.object({
  email: z.string().trim().email("Enter a valid email."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

const taskSchema = z.object({
  title: z.string().trim().min(2, "Task title is required.").max(120),
  description: z.string().trim().max(600).optional(),
  category: z.string().trim().min(2).max(40),
  assignment_context: z.string().trim().max(80).optional(),
  assignee_name: z.string().trim().max(60).optional(),
  due_at: z.string().optional(),
  reminder_at: z.string().optional(),
  estimated_minutes: z.coerce.number().int().min(5).max(1440),
  priority: z.enum(["low", "medium", "high"]),
});

type Task = Tables<"tasks">;
type Profile = Tables<"profiles">;
type Status = "todo" | "in_progress" | "done";
type TaskForm = z.infer<typeof taskSchema>;

const emptyTask: TaskForm = {
  title: "",
  description: "",
  category: "Assignment",
  assignment_context: "",
  assignee_name: "",
  due_at: "",
  reminder_at: "",
  estimated_minutes: 45,
  priority: "medium",
};

const statusLabels: Record<Status, string> = {
  todo: "To plan",
  in_progress: "In focus",
  done: "Completed",
};

const priorityClasses: Record<string, string> = {
  high: "bg-deadline text-deadline-foreground",
  medium: "bg-warning text-warning-foreground",
  low: "bg-success text-success-foreground",
};

const formatDate = (value: string | null) => {
  if (!value) return "No date";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
};

const toDateTimeLocal = (value: string) => (value ? new Date(value).toISOString().slice(0, 16) : null);

export function TaskManager() {
  const [session, setSession] = useState<Session | null>(null);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authForm, setAuthForm] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [taskForm, setTaskForm] = useState(emptyTask);
  const [activeStatus, setActiveStatus] = useState<Status>("todo");
  const [isSaving, setIsSaving] = useState(false);
  const [view, setView] = useState<"tasks" | "calendar">("tasks");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [filterStatus, setFilterStatus] = useState<Status | "all">("all");
  const [filterPriority, setFilterPriority] = useState<"all" | "low" | "medium" | "high">("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const user = session?.user;
    if (!user) {
      setTasks([]);
      setProfile(null);
      return;
    }

    const loadData = async () => {
      const displayName = user.user_metadata?.full_name || user.email?.split("@")[0] || "Focused user";
      await supabase.from("profiles").upsert(
        { user_id: user.id, display_name: displayName, avatar_url: user.user_metadata?.avatar_url ?? null },
        { onConflict: "user_id" },
      );

      const [{ data: profileData }, { data: taskData, error }] = await Promise.all([
        supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle(),
        supabase.from("tasks").select("*").order("due_at", { ascending: true, nullsFirst: false }),
      ]);

      if (error) toast.error(error.message);
      setProfile(profileData);
      setTasks(taskData ?? []);
    };

    loadData();

    const channel = supabase
      .channel("task-manager-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `user_id=eq.${user.id}` }, (payload) => {
        setTasks((prev) => {
          if (payload.eventType === "INSERT") return [...prev, payload.new as Task];
          if (payload.eventType === "UPDATE") return prev.map((t) => (t.id === (payload.new as Task).id ? (payload.new as Task) : t));
          if (payload.eventType === "DELETE") return prev.filter((t) => t.id !== (payload.old as Task).id);
          return prev;
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session]);

  const stats = useMemo(() => {
    const open = tasks.filter((task) => task.status !== "done").length;
    const done = tasks.filter((task) => task.status === "done").length;
    const dueSoon = tasks.filter((task) => task.due_at && task.status !== "done" && new Date(task.due_at).getTime() - Date.now() < 1000 * 60 * 60 * 36).length;
    const minutes = tasks.filter((task) => task.status !== "done").reduce((sum, task) => sum + task.estimated_minutes, 0);
    return { open, done, dueSoon, minutes };
  }, [tasks]);

  const calendarTasks = useMemo(() => tasks.filter((task) => task.due_at).slice(0, 8), [tasks]);

  const categoryOptions = useMemo(() => Array.from(new Set(tasks.map((t) => t.category).filter(Boolean))), [tasks]);

  const filteredCalendarTasks = useMemo(() => tasks.filter((t) => {
    if (!t.due_at) return false;
    if (filterStatus !== "all" && t.status !== filterStatus) return false;
    if (filterPriority !== "all" && t.priority !== filterPriority) return false;
    if (filterCategory !== "all" && t.category !== filterCategory) return false;
    return true;
  }), [tasks, filterStatus, filterPriority, filterCategory]);

  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    filteredCalendarTasks.forEach((task) => {
      const key = new Date(task.due_at!).toDateString();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(task);
    });
    return map;
  }, [filteredCalendarTasks]);

  const daysWithTasks = useMemo(() => Array.from(tasksByDay.keys()).map((d) => new Date(d)), [tasksByDay]);

  const tasksForSelectedDate = useMemo(() => {
    if (!selectedDate) return [];
    return tasksByDay.get(selectedDate.toDateString()) ?? [];
  }, [tasksByDay, selectedDate]);

  const handleEmailAuth = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = authSchema.safeParse(authForm);
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message);
      return;
    }

    setIsAuthLoading(true);
    const payload = { email: parsed.data.email, password: parsed.data.password };
    const result = authMode === "signin"
      ? await supabase.auth.signInWithPassword(payload)
      : await supabase.auth.signUp({ ...payload, options: { emailRedirectTo: window.location.origin } });
    setIsAuthLoading(false);

    if (result.error) {
      toast.error(result.error.message);
      return;
    }

    toast.success(authMode === "signin" ? "Welcome back." : "Check your email to confirm your account.");
  };
  const handleGoogle = async () => {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin,
    },
  });

  if (error) {
    toast.error(error.message);
  }
};

  const handlePasswordReset = async () => {
    const email = authForm.email.trim();
    if (!z.string().email().safeParse(email).success) {
      toast.error("Enter your email first.");
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
    if (error) toast.error(error.message);
    else toast.success("Password reset email sent.");
  };

  const createTask = async (event: FormEvent) => {
    event.preventDefault();
    if (!session?.user) return;
    const parsed = taskSchema.safeParse(taskForm);
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message);
      return;
    }

    setIsSaving(true);
    const data = parsed.data;
    const { data: created, error } = await supabase
      .from("tasks")
      .insert({
        user_id: session.user.id,
        title: data.title,
        description: data.description || null,
        category: data.category,
        assignment_context: data.assignment_context || null,
        assignee_name: data.assignee_name || null,
        due_at: toDateTimeLocal(data.due_at ?? ""),
        reminder_at: toDateTimeLocal(data.reminder_at ?? ""),
        estimated_minutes: data.estimated_minutes,
        priority: data.priority,
        status: activeStatus,
      })
      .select("*")
      .single();

    if (created) {
      await supabase.from("task_activity").insert({ user_id: session.user.id, task_id: created.id, action: "created", details: `Added ${created.title}` });
    }
    setIsSaving(false);

    if (error) toast.error(error.message);
    else {
      setTaskForm(emptyTask);
      toast.success("Task added to your plan.");
    }
  };

  const updateTaskStatus = async (task: Task, status: Status) => {
  const previousTask = task;

  const updatedTask = {
    ...task,
    status,
    completed_at: status === "done" ? new Date().toISOString() : null,
  };

  // 1. Update UI instantly
  setTasks((prev) =>
    prev.map((t) =>
      t.id === task.id ? updatedTask : t
    )
  );

  // 2. Update database
  const { error } = await supabase
    .from("tasks")
    .update({
      status,
      completed_at: status === "done" ? new Date().toISOString() : null,
    })
    .eq("id", task.id);

  // 3. If database fails, restore old UI
  if (error) {
    toast.error(error.message);

    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id ? previousTask : t
      )
    );
  }
};

  if (!session) {
    return (
      <main className="min-h-screen bg-app-gradient px-4 py-6 sm:px-6 lg:px-8">
        <section className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-6xl items-center gap-6 lg:grid-cols-[1.08fr_0.92fr]">
          <div className="animate-float-in space-y-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-4 py-2 text-sm font-bold text-primary shadow-lift backdrop-blur">
              <Sparkles className="h-4 w-4" /> Smart Task & Assignment Manager
            </div>
            <div className="space-y-5">
              <h1 className="max-w-3xl font-display text-4xl font-extrabold leading-tight tracking-normal text-foreground sm:text-5xl lg:text-6xl">
                Plan deadlines, assignments, and focus blocks in one calm cockpit.
              </h1>
              <p className="max-w-2xl text-lg font-medium leading-8 text-muted-foreground">
                A full-stack productivity workspace with secure accounts, task CRUD, calendar scheduling, reminders, and live task updates.
              </p>
            </div>
            <div className="grid max-w-2xl grid-cols-3 gap-3">
              {[
                ["Deadline radar", "Never miss submission windows"],
                ["Focus load", "Balance effort across days"],
                ["Live sync", "Updates appear instantly"],
              ].map(([title, body]) => (
                <div key={title} className="glass-panel rounded-lg border border-border p-4 shadow-lift transition-transform hover:-translate-y-1">
                  <p className="font-display text-sm font-bold text-foreground">{title}</p>
                  <p className="mt-2 text-xs font-semibold leading-5 text-muted-foreground">{body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-panel animate-float-in rounded-xl border border-border p-5 shadow-panel sm:p-7">
            <Tabs value={authMode} onValueChange={(value) => setAuthMode(value as "signin" | "signup")} className="space-y-5">
              <TabsList className="grid w-full grid-cols-2 bg-muted">
                <TabsTrigger value="signin">Login</TabsTrigger>
                <TabsTrigger value="signup">Sign up</TabsTrigger>
              </TabsList>
              <TabsContent value={authMode} className="m-0">
                <form onSubmit={handleEmailAuth} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" value={authForm.email} onChange={(event) => setAuthForm((form) => ({ ...form, email: event.target.value }))} placeholder="you@example.com" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <div className="relative">
                      <Input id="password" type={showPassword ? "text" : "password"} value={authForm.password} onChange={(event) => setAuthForm((form) => ({ ...form, password: event.target.value }))} placeholder="Minimum 8 characters" className="pr-11" />
                      <button type="button" onClick={() => setShowPassword((value) => !value)} className="focus-ring absolute right-2 top-1/2 rounded-md p-2 text-muted-foreground -translate-y-1/2 hover:text-foreground" aria-label={showPassword ? "Hide password" : "Show password"}>
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <Button type="submit" variant="hero" className="w-full" disabled={isAuthLoading}>{authMode === "signin" ? "Login" : "Create account"}</Button>
                </form>
                <div className="mt-4 grid gap-3">
                  <Button type="button" variant="glass" className="w-full" onClick={handleGoogle}>Continue with Google</Button>
                  <button type="button" onClick={handlePasswordReset} className="focus-ring rounded-md text-sm font-bold text-primary hover:text-foreground">Forgot password?</button>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-app-gradient px-4 py-5 sm:px-6 lg:px-8">
      <section className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[280px_1fr]">
        <aside className="rounded-xl bg-hero-gradient p-5 text-surface-strong-foreground shadow-panel lg:min-h-[calc(100vh-2.5rem)]">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-card/15 font-display text-lg font-extrabold">{profile?.display_name?.[0]?.toUpperCase() ?? "S"}</div>
            <div>
              <p className="font-display text-lg font-bold">{profile?.display_name ?? "Smart Planner"}</p>
              <p className="text-sm font-semibold opacity-75">{session.user.email}</p>
            </div>
          </div>

          <nav className="mt-6 grid gap-2">
            {([
              ["tasks", LayoutDashboard, "Tasks"],
              ["calendar", CalendarRange, "Calendar"],
            ] as Array<[typeof view, LucideIcon, string]>).map(([key, Icon, label]) => (
              <button
                key={key}
                onClick={() => setView(key)}
                className={cn(
                  "focus-ring flex items-center gap-3 rounded-lg px-4 py-3 text-left text-sm font-bold transition-all",
                  view === key ? "bg-card/25 text-surface-strong-foreground shadow-lift" : "bg-card/5 text-surface-strong-foreground/75 hover:bg-card/15",
                )}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </nav>

          <div className="mt-8 grid gap-3">
            {([
              [LayoutDashboard, "Open tasks", stats.open],
              [Flame, "Due soon", stats.dueSoon],
              [Clock3, "Focus minutes", stats.minutes],
              [CheckCircle2, "Completed", stats.done],
            ] as Array<[LucideIcon, string, number]>).map(([Icon, label, value]) => (
              <div key={String(label)} className="rounded-lg border border-card/20 bg-card/10 p-4 backdrop-blur transition-transform hover:translate-x-1">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-bold opacity-85"><Icon className="h-4 w-4" />{String(label)}</div>
                  <span className="font-display text-2xl font-extrabold">{String(value)}</span>
                </div>
              </div>
            ))}
          </div>

          <Button variant="glass" className="mt-8 w-full border-card/20 bg-card/10 text-surface-strong-foreground hover:bg-card/20" onClick={() => supabase.auth.signOut()}>
            <LogOut className="h-4 w-4" /> Logout
          </Button>
        </aside>

        <div className="space-y-5">
          <header className="glass-panel rounded-xl border border-border p-5 shadow-lift sm:p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="font-bold text-primary">Today's command center</p>
                <h2 className="mt-1 font-display text-3xl font-extrabold tracking-normal sm:text-4xl">Assignments, deadlines, reminders</h2>
              </div>
              <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-muted p-1 text-sm font-bold md:grid-cols-3">
                {view === "tasks" ? (Object.keys(statusLabels) as Status[]).map((status) => (
                  <button key={status} onClick={() => setActiveStatus(status)} className={`focus-ring rounded-md px-3 py-2 transition-all ${activeStatus === status ? "bg-card text-foreground shadow-lift" : "text-muted-foreground hover:text-foreground"}`}>
                    {statusLabels[status]}
                  </button>
                )) : (
                  <button onClick={() => setSelectedDate(new Date())} className="focus-ring col-span-2 rounded-md bg-card px-3 py-2 text-foreground shadow-lift md:col-span-3">Jump to today</button>
                )}
              </div>
            </div>
          </header>

          {view === "tasks" ? (
          <>
          <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
            <form onSubmit={createTask} className="glass-panel rounded-xl border border-border p-5 shadow-panel sm:p-6">
              <div className="mb-5 flex items-center justify-between gap-3">
                <h3 className="font-display text-xl font-bold">Add task</h3>
                <span className="rounded-full bg-primary px-3 py-1 text-xs font-extrabold text-primary-foreground">{statusLabels[activeStatus]}</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2"><Label>Title</Label><Input value={taskForm.title} onChange={(e) => setTaskForm((f) => ({ ...f, title: e.target.value }))} placeholder="Finish calculus problem set" /></div>
                <div className="space-y-2 sm:col-span-2"><Label>Description</Label><Textarea value={taskForm.description} onChange={(e) => setTaskForm((f) => ({ ...f, description: e.target.value }))} placeholder="Notes, rubric, links, or submission details" /></div>
                <div className="space-y-2"><Label>Category</Label><Input value={taskForm.category} onChange={(e) => setTaskForm((f) => ({ ...f, category: e.target.value }))} /></div>
                <div className="space-y-2"><Label>Course / Project</Label><Input value={taskForm.assignment_context} onChange={(e) => setTaskForm((f) => ({ ...f, assignment_context: e.target.value }))} placeholder="CS-301" /></div>
                <div className="space-y-2"><Label>Due date</Label><Input type="datetime-local" value={taskForm.due_at} onChange={(e) => setTaskForm((f) => ({ ...f, due_at: e.target.value }))} /></div>
                <div className="space-y-2"><Label>Reminder</Label><Input type="datetime-local" value={taskForm.reminder_at} onChange={(e) => setTaskForm((f) => ({ ...f, reminder_at: e.target.value }))} /></div>
                <div className="space-y-2"><Label>Priority</Label><select value={taskForm.priority} onChange={(e) => setTaskForm((f) => ({ ...f, priority: e.target.value as "low" | "medium" | "high" }))} className="focus-ring flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-semibold"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
                <div className="space-y-2"><Label>Effort minutes</Label><Input type="number" min="5" max="1440" value={taskForm.estimated_minutes} onChange={(e) => setTaskForm((f) => ({ ...f, estimated_minutes: Number(e.target.value) }))} /></div>
              </div>
              <Button variant="hero" className="mt-5 w-full" disabled={isSaving}><Plus className="h-4 w-4" /> Add to planner</Button>
            </form>

            <section className="grid gap-4">
              {(Object.keys(statusLabels) as Status[]).map((status) => {
                const statusTasks = tasks.filter((task) => task.status === status);
                return (
                  <div key={status} className="glass-panel rounded-xl border border-border p-4 shadow-lift">
                    <div className="mb-3 flex items-center justify-between"><h3 className="font-display text-lg font-bold">{statusLabels[status]}</h3><span className="rounded-full bg-muted px-3 py-1 text-xs font-extrabold text-muted-foreground">{statusTasks.length}</span></div>
                    <div className="grid gap-3">
                      {statusTasks.length === 0 ? <p className="rounded-lg border border-dashed border-border bg-surface p-4 text-sm font-semibold text-muted-foreground">No tasks here yet.</p> : statusTasks.map((task) => (
                        <article key={task.id} className="rounded-lg border border-border bg-card p-4 shadow-lift transition-transform hover:-translate-y-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0"><h4 className="font-display font-bold leading-6">{task.title}</h4><p className="mt-1 text-sm font-semibold text-muted-foreground">{task.assignment_context || task.category} · {formatDate(task.due_at)}</p></div>
                            <span className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${priorityClasses[task.priority] ?? priorityClasses.medium}`}>{task.priority}</span>
                          </div>
                          {task.description ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{task.description}</p> : null}
                          <div className="mt-4 flex flex-wrap items-center gap-2">
                            {status !== "todo" ? <Button size="sm" variant="glass" onClick={() => updateTaskStatus(task, "todo")}>Plan</Button> : null}
                            {status !== "in_progress" ? <Button size="sm" variant="warm" onClick={() => updateTaskStatus(task, "in_progress")}>Focus</Button> : null}
                            {status !== "done" ? <Button size="sm" variant="hero" onClick={() => updateTaskStatus(task, "done")}>Done</Button> : null}
                            <Button size="sm" variant="ghost" onClick={() => deleteTask(task)} aria-label={`Delete ${task.title}`}><Trash2 className="h-4 w-4" /></Button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
          </div>

          <section className="glass-panel rounded-xl border border-border p-5 shadow-panel">
            <div className="mb-4 flex items-center gap-2"><CalendarDays className="h-5 w-5 text-primary" /><h3 className="font-display text-xl font-bold">Calendar radar</h3></div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {calendarTasks.length === 0 ? <p className="text-sm font-semibold text-muted-foreground">Add due dates to populate your calendar.</p> : calendarTasks.map((task) => (
                <div key={task.id} className="rounded-lg border border-border bg-card p-4 transition-transform hover:-translate-y-1">
                  <p className="text-xs font-extrabold uppercase tracking-wide text-primary">{formatDate(task.due_at)}</p>
                  <p className="mt-2 font-display font-bold">{task.title}</p>
                  <p className="mt-1 text-sm font-semibold text-muted-foreground">Reminder: {formatDate(task.reminder_at)}</p>
                </div>
              ))}
            </div>
          </section>
          </>
          ) : (
          <div className="grid gap-5 lg:grid-cols-[auto_1fr]">
            <div className="glass-panel rounded-xl border border-border p-4 shadow-panel">
              <Suspense fallback={<div className="h-72 w-72 animate-pulse rounded-md bg-muted" />}>
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  modifiers={{ hasTasks: daysWithTasks }}
                  modifiersClassNames={{ hasTasks: "relative font-extrabold text-primary after:absolute after:bottom-1 after:left-1/2 after:h-1 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-primary" }}
                  className={cn("p-3 pointer-events-auto")}
                />
              </Suspense>
              <div className="mt-4 grid gap-3 border-t border-border pt-4">
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">Status</Label>
                  <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as Status | "all")} className="focus-ring flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-semibold">
                    <option value="all">All statuses</option>
                    {(Object.keys(statusLabels) as Status[]).map((s) => <option key={s} value={s}>{statusLabels[s]}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">Priority</Label>
                  <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value as typeof filterPriority)} className="focus-ring flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-semibold">
                    <option value="all">All priorities</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">Category</Label>
                  <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="focus-ring flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-semibold">
                    <option value="all">All categories</option>
                    {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                {(filterStatus !== "all" || filterPriority !== "all" || filterCategory !== "all") && (
                  <Button size="sm" variant="ghost" onClick={() => { setFilterStatus("all"); setFilterPriority("all"); setFilterCategory("all"); }}>Clear filters</Button>
                )}
              </div>
            </div>
            <section className="glass-panel rounded-xl border border-border p-5 shadow-panel">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-primary" /><h3 className="font-display text-xl font-bold">{selectedDate ? new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(selectedDate) : "Pick a date"}</h3></div>
                <span className="rounded-full bg-muted px-3 py-1 text-xs font-extrabold text-muted-foreground">{tasksForSelectedDate.length} task{tasksForSelectedDate.length === 1 ? "" : "s"}</span>
              </div>
              <div className="grid gap-3">
                {tasksForSelectedDate.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border bg-surface p-6 text-center text-sm font-semibold text-muted-foreground">No tasks due on this date.</p>
                ) : tasksForSelectedDate.map((task) => (
                  <article key={task.id} className="rounded-lg border border-border bg-card p-4 shadow-lift transition-transform hover:-translate-y-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="font-display font-bold leading-6">{task.title}</h4>
                        <p className="mt-1 text-sm font-semibold text-muted-foreground">{task.assignment_context || task.category} · {formatDate(task.due_at)}</p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${priorityClasses[task.priority] ?? priorityClasses.medium}`}>{task.priority}</span>
                    </div>
                    {task.description ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{task.description}</p> : null}
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {task.status !== "in_progress" ? <Button size="sm" variant="warm" onClick={() => updateTaskStatus(task, "in_progress")}>Focus</Button> : null}
                      {task.status !== "done" ? <Button size="sm" variant="hero" onClick={() => updateTaskStatus(task, "done")}>Done</Button> : null}
                      <Button size="sm" variant="ghost" onClick={() => deleteTask(task)} aria-label={`Delete ${task.title}`}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
          )}
        </div>
      </section>
    </main>
  );
}
