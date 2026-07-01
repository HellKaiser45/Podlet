import { createSignal, For, type Component } from "solid-js";

// ─── Types ────────────────────────────────────────────────────────────────────

type InventoryTab = "Models" | "Skills" | "MCPs";

interface EquipSlot {
  icon: string;
  label: string;
  color: "primary" | "secondary" | "accent" | "empty";
}
interface GridItem {
  icon: string;
  color: "primary" | "secondary" | "accent" | "neutral";
  equipped?: boolean;
  empty?: boolean;
  addNew?: boolean;
}

// ─── Static data ──────────────────────────────────────────────────────────────

const equipSlots: EquipSlot[] = [
  { icon: "bolt", label: "MODEL", color: "primary" },
  { icon: "terminal", label: "SKILL_1", color: "secondary" },
  { icon: "add", label: "SKILL_2", color: "empty" },
  { icon: "extension", label: "MCP_1", color: "accent" },
  { icon: "add", label: "MCP_2", color: "empty" },
];

const gridItems: GridItem[] = [
  { icon: "bolt", color: "primary", equipped: true },
  { icon: "psychology", color: "neutral" },
  { icon: "smart_toy", color: "neutral" },
  { icon: "code", color: "neutral" },
  { icon: "terminal", color: "secondary" },
  ...Array(10).fill(null).map(() => ({ icon: "", color: "neutral" as const, empty: true })),
  { icon: "add", color: "neutral", addNew: true },
];

// ─── Pokémon Card ─────────────────────────────────────────────────────────────

/** Tiny energy cost orb */
const Orb: Component<{ size?: number }> = (props) => (
  <div style={{
    width: `${props.size ?? 12}px`,
    height: `${props.size ?? 12}px`,
    background: "radial-gradient(circle at 35% 35%, #e0aaff, #6c2bd9)",
    "border-radius": "50%",
    border: "1.5px solid rgba(255,255,255,0.35)",
    "flex-shrink": "0",
  }} />
);

const PokemonAgentCard: Component = () => (
  <>
    <style>{`
      @keyframes holoSweep {
        0%   { transform: translateX(-120%) skewX(-15deg); opacity: 1; }
        100% { transform: translateX(260%)  skewX(-15deg); opacity: 1; }
      }
      @keyframes holoRainbow {
        0%   { background-position: 0%   50%; }
        50%  { background-position: 100% 50%; }
        100% { background-position: 0%   50%; }
      }
      .poke-root:hover .poke-sweep  { animation: holoSweep   1.3s cubic-bezier(.4,0,.2,1) forwards; }
      .poke-root:hover .poke-foil   { opacity: 1; animation: holoRainbow 4s ease infinite; }
      .poke-foil  { opacity: 0; transition: opacity .4s ease; }
      .poke-sweep { transform: translateX(-120%) skewX(-15deg); opacity: 0; }

      /* ── scale card text with its own inline-size ── */
      .poke-inner { container-type: inline-size; }
      .poke-name      { font-size: clamp(14px, 6cqi, 22px); }
      .poke-hp        { font-size: clamp(9px,  3.5cqi, 14px); }
      .poke-move-name { font-size: clamp(6px,  2.8cqi, 10px); }
      .poke-move-dmg  { font-size: clamp(12px, 5.5cqi, 20px); }
      .poke-move-desc { font-size: clamp(5px,  2.2cqi, 8px); }
      .poke-tiny      { font-size: clamp(5px,  2cqi,   8px); }
      .poke-stat-lbl  { font-size: clamp(6px,  2.5cqi, 9px); }
    `}</style>

    {/* hover-3d wrapper ─ card constrained to official 63:88 ratio */}
    <div
      class="hover-3d poke-root w-full"
      style={{ "max-width": "320px", "aspect-ratio": "63/88", cursor: "default" }}
    >
      {/* Gold outer border — fills 100% of the wrapper */}
      <div style={{
        width: "100%", height: "100%",
        background: "linear-gradient(145deg,#ffe066,#ffd700,#ffb300,#ffe566,#ffd700)",
        padding: "3.5%",
        "border-radius": "5%",
        "box-shadow": "0 8px 40px rgba(0,0,0,.75), inset 0 1px 0 rgba(255,255,255,.45), inset 0 -1px 0 rgba(0,0,0,.3)",
        "box-sizing": "border-box",
      }}>

        {/* Card body — flex column fills gold inset exactly */}
        <div
          class="poke-inner"
          style={{
            width: "100%", height: "100%",
            background: "linear-gradient(155deg,#2a1a5e 0%,#1a0f3e 40%,#0f0a2e 100%)",
            "border-radius": "2.5%",
            overflow: "hidden",
            position: "relative",
            display: "flex",
            "flex-direction": "column",
          }}
        >

          {/* Holographic foil */}
          <div class="poke-foil" style={{
            position: "absolute", inset: "0", "z-index": "10", "pointer-events": "none",
            background: "linear-gradient(125deg,transparent 10%,rgba(255,0,128,.08) 25%,rgba(255,165,0,.08) 35%,rgba(255,255,0,.08) 45%,rgba(0,255,128,.08) 55%,rgba(0,128,255,.08) 65%,rgba(128,0,255,.08) 75%,transparent 90%)",
            "background-size": "300% 300%",
            "mix-blend-mode": "screen",
            "border-radius": "2.5%",
          }} />
          {/* Sweep flash */}
          <div class="poke-sweep" style={{
            position: "absolute", top: "0", left: "0",
            width: "35%", height: "100%", "z-index": "11", "pointer-events": "none",
            background: "linear-gradient(90deg,transparent,rgba(255,255,255,.14),transparent)",
          }} />

          {/* ── Header (flex-none) ── */}
          <div style={{
            display: "flex", "justify-content": "space-between", "align-items": "center",
            padding: "3% 4% 1%", "flex-shrink": "0",
          }}>
            <div style={{ display: "flex", "align-items": "center", gap: "4%" }}>
              <span style={{
                background: "linear-gradient(135deg,#ffe066,#ffd700)",
                color: "#1a0f3e", "font-weight": "800", padding: "1% 4%",
                "border-radius": "20%", "letter-spacing": "0.04em",
              }} class="poke-tiny">BASIC</span>
              <span class="poke-name" style={{
                "font-weight": "800", color: "#f0e6ff", "letter-spacing": "-0.02em",
                "text-shadow": "0 0 12px rgba(203,166,247,.6)",
              }}>CYPHER</span>
            </div>
            <div style={{ display: "flex", "align-items": "center", gap: "3%" }}>
              <span class="poke-hp" style={{ "font-weight": "700", color: "#f0e6ff" }}>120 HP</span>
              <div style={{
                width: "6%", "aspect-ratio": "1",
                background: "radial-gradient(circle at 35% 35%,#e0aaff,#6c2bd9)",
                "border-radius": "50%", display: "flex", "align-items": "center",
                "justify-content": "center", border: "1.5px solid rgba(255,255,255,.4)",
                "box-shadow": "0 0 8px rgba(203,166,247,.5)",
                "min-width": "18px", "min-height": "18px",
              }}>
                <span class="poke-tiny" style={{ color: "#fff" }}>⚡</span>
              </div>
            </div>
          </div>

          {/* ── Artwork (flex-grow largest section) ── */}
          <div style={{ padding: "0 3.5% 2%", flex: "0 0 42%" }}>
            <div style={{
              width: "100%", height: "100%",
              border: "2px solid #ffd700", "border-radius": "2%",
              overflow: "hidden", background: "#000", position: "relative",
            }}>
              <img
                src="https://lh3.googleusercontent.com/aida/ADBb0uje16ABIrjap0K4ClcyDOuMFi_2ZdHyp8x9RxhlD4MB27VyF7dUYC4CmacCwC2sFgH24anGXSapKWCQOTBMRJnsdL7AxwGR_dKQzWQZJxT75IE_2S8NgeaAPDfKxjQKDyb1R1KSf9m_rP6ASGt6EmV2EtPG2GpNyvFWENXrt5i31BtVLX7_TjsEzQUwGx25UfwipCcOL7inQg0Cb6hJx2d4oQMWP3XnRz0FcGg1TEwqhjBjas8iG968SkwqTuze2emJnw8_ypfikw"
                alt="CYPHER"
                style={{ width: "100%", height: "100%", "object-fit": "contain", filter: "contrast(1.2) saturate(.6)" }}
              />
              <div style={{
                position: "absolute", inset: "0", "pointer-events": "none",
                background: "linear-gradient(to bottom,transparent 50%,rgba(203,166,247,.05) 50%)",
                "background-size": "100% 4px",
              }} />
              <div class="poke-tiny" style={{
                position: "absolute", bottom: "2%", right: "3%",
                color: "rgba(255,255,255,.3)", "font-family": "monospace",
              }}>illus. Sanctuary Archives</div>
            </div>
          </div>

          {/* ── Species line ── */}
          <div class="poke-tiny" style={{
            padding: "0 4% 1.5%", color: "rgba(220,200,255,.4)",
            "font-style": "italic", "text-align": "center", "flex-shrink": "0",
          }}>
            Cyber Rogue Pokémon · Ht: Unknown · Wt: ???kg · Sync: 85%
          </div>

          {/* ── Moves (flex-grow) ── */}
          <div style={{
            padding: "1.5% 4% 1%",
            "border-top": "1px solid rgba(255,255,255,.1)",
            flex: "1", display: "flex", "flex-direction": "column",
            gap: "1%", "justify-content": "space-evenly",
          }}>
            {/* Move 1 */}
            <div style={{ display: "flex", "align-items": "flex-start", gap: "3%" }}>
              <div style={{ display: "flex", gap: "2%", "padding-top": "1%", "flex-shrink": "0", "align-items": "center" }}>
                <Orb /><Orb />
              </div>
              <div style={{ flex: "1", "min-width": "0" }}>
                <div class="poke-move-name" style={{ "font-weight": "800", color: "#d4b8ff", "letter-spacing": ".04em" }}>
                  VULNERABILITY SCAN
                </div>
                <div class="poke-move-desc" style={{ color: "rgba(200,180,255,.5)", "line-height": "1.35", "margin-top": "0.5%" }}>
                  Reveal 2 exploit vectors. Opponent shows hand.
                </div>
              </div>
              <div class="poke-move-dmg" style={{
                "font-weight": "800", color: "#f0e6ff", "min-width": "10%",
                "text-align": "right", "text-shadow": "0 0 8px rgba(203,166,247,.4)",
              }}>80</div>
            </div>

            {/* Move 2 */}
            <div style={{ display: "flex", "align-items": "flex-start", gap: "3%" }}>
              <div style={{ display: "flex", gap: "2%", "padding-top": "1%", "flex-shrink": "0", "flex-wrap": "wrap", "max-width": "14%", "align-items": "center" }}>
                <Orb /><Orb /><Orb />
              </div>
              <div style={{ flex: "1", "min-width": "0" }}>
                <div class="poke-move-name" style={{ "font-weight": "800", color: "#d4b8ff", "letter-spacing": ".04em" }}>
                  ZERO-DAY EXPLOIT
                </div>
                <div class="poke-move-desc" style={{ color: "rgba(200,180,255,.5)", "line-height": "1.35", "margin-top": "0.5%" }}>
                  Discard 2 from opponent's defense stack.
                </div>
              </div>
              <div class="poke-move-dmg" style={{
                "font-weight": "800", color: "#f38ba8", "min-width": "10%",
                "text-align": "right", "text-shadow": "0 0 8px rgba(243,139,168,.4)",
              }}>150</div>
            </div>
          </div>

          {/* ── Bottom stats ── */}
          <div style={{
            display: "flex", "justify-content": "space-between", "align-items": "center",
            background: "rgba(0,0,0,.4)",
            "border-top": "1px solid rgba(255,255,255,.08)",
            padding: "1.5% 4%", "flex-shrink": "0",
          }}>
            {[
              { label: "Weakness", value: "🔥 ×2" },
              { label: "Resistance", value: "– –" },
              { label: "Retreat", value: "⚡⚡" },
            ].map(({ label, value }) => (
              <div style={{ "text-align": "center" }}>
                <div class="poke-stat-lbl" style={{ "font-weight": "700", color: "rgba(220,200,255,.7)" }}>{label}</div>
                <div class="poke-tiny" style={{ color: "rgba(220,200,255,.4)", "margin-top": "1px" }}>{value}</div>
              </div>
            ))}
          </div>

          {/* ── Card footer ── */}
          <div style={{
            display: "flex", "justify-content": "space-between", "align-items": "center",
            padding: "1% 4% 2%", "flex-shrink": "0",
          }}>
            <div class="poke-tiny" style={{ color: "rgba(220,200,255,.25)" }}>©PODLET_OS Sanctuary Archives</div>
            <div class="poke-tiny" style={{ color: "rgba(220,200,255,.55)", "font-weight": "700", "letter-spacing": ".04em" }}>042/264 ★</div>
          </div>

        </div>{/* /card body */}
      </div>{/* /gold border */}

      {/* 8 zones required by hover-3d */}
      <div /><div /><div /><div />
      <div /><div /><div /><div />
    </div>
  </>
);

// ─── Equip Slot ───────────────────────────────────────────────────────────────

const EquipSlotCard: Component<{ slot: EquipSlot }> = (props) => {
  const border = () => ({
    primary: "border-2 border-primary   bg-primary/10   text-primary   shadow-[0_0_8px_oklch(var(--p)/.2)]",
    secondary: "border   border-secondary bg-secondary/10 text-secondary",
    accent: "border   border-accent    bg-accent/10    text-accent",
    empty: "border   border-base-content/20 border-dashed bg-transparent text-base-content/25",
  }[props.slot.color]);
  const lbl = () => ({
    primary: "text-primary", secondary: "text-secondary",
    accent: "text-accent", empty: "text-base-content/40",
  }[props.slot.color]);

  return (
    <div class="flex flex-col items-center gap-1">
      <div class={`w-full aspect-square flex items-center justify-center ${border()}`}>
        <span class="material-symbols-outlined text-lg sm:text-xl">{props.slot.icon}</span>
      </div>
      <span class={`text-[8px] font-bold ${lbl()}`}>{props.slot.label}</span>
    </div>
  );
};

// ─── Grid Item Slot ───────────────────────────────────────────────────────────

const GridItemSlot: Component<{ item: GridItem }> = (props) => {
  const s = props.item;
  if (s.empty) return <div class="aspect-square bg-base-200 border border-base-300 opacity-20" />;
  if (s.addNew) return (
    <div class="aspect-square bg-base-200 border border-base-300 border-dashed opacity-50 flex items-center justify-center hover:border-primary transition-all cursor-pointer">
      <span class="material-symbols-outlined text-xs">add</span>
    </div>
  );
  const cls = () => ({
    primary: "border-2 border-primary   bg-primary/5   text-primary",
    secondary: "border   border-secondary bg-base-200    text-secondary",
    accent: "border   border-accent    bg-base-200    text-accent",
    neutral: "border   border-base-300  bg-base-200    text-base-content/40 hover:text-primary",
  }[s.color]);
  return (
    <div class={`aspect-square flex items-center justify-center relative cursor-pointer group transition-all duration-200 hover:border-primary hover:bg-base-100 ${cls()}`}>
      <span class="material-symbols-outlined text-base group-hover:scale-110 transition-transform">{s.icon}</span>
      {s.equipped && <div class="absolute -top-1 -right-1 w-2 h-2 bg-primary" />}
    </div>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

const AgentHUD: Component = () => {
  const [activeTab, setActiveTab] = createSignal<InventoryTab>("Models");
  const [mobileTab, setMobileTab] = createSignal<"unit" | "inv" | "log">("unit");
  const [systemPrompt, setSystemPrompt] = createSignal(
    "You are a highly specialized security AI known as Cypher. Your primary directive is to identify vulnerabilities in complex architectures while maintaining a cryptic, yet helpful digital persona. Speak in short, concise fragments."
  );
  const [dataLog, setDataLog] = createSignal(
    "High-frequency analytical unit optimized for code synthesis and cryptographic decryption. Operates within the Lunar sector of the Sanctuary. No anomalies detected in current cycle."
  );

  const tabs: InventoryTab[] = ["Models", "Skills", "MCPs"];

  return (
    <div class="min-h-screen bg-base-300 text-base-content font-mono selection:bg-primary/30 selection:text-primary">

      {/* ── Header ── */}
      <header class="border-b border-base-content/10 bg-base-100/50 backdrop-blur-md sticky top-0 z-50">
        <div class="max-w-[1440px] mx-auto px-4 sm:px-6 py-3 flex justify-between items-center gap-4">
          <div class="flex items-center gap-4 sm:gap-10 min-w-0">
            <span class="text-primary font-bold text-base sm:text-xl tracking-tighter shrink-0">[PODLET_OS]</span>
            <nav class="hidden md:flex items-center gap-4 lg:gap-6 text-xs font-bold uppercase tracking-widest">
              {["Agents", "Inventory", "Logs", "Config"].map((item, i) => (
                <a href="#" class={i === 0
                  ? "text-primary border-b border-primary pb-1"
                  : "text-base-content/50 hover:text-primary transition-colors"}>
                  {item}
                </a>
              ))}
            </nav>
          </div>
          <div class="flex items-center gap-2 sm:gap-4 shrink-0">
            <div class="text-[10px] text-base-content/40 text-right hidden sm:block leading-relaxed">
              <div>SYS_STATUS: OPTIMAL</div>
              <div>LATENCY: 24MS</div>
            </div>
            {["account_circle", "settings"].map((icon) => (
              <button class="btn btn-ghost btn-sm btn-square">
                <span class="material-symbols-outlined text-lg sm:text-xl">{icon}</span>
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ── Body ── */}
      <main class="max-w-[1440px] mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-28 md:pb-8">
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8">

          {/* ── Left column ── */}
          <aside class="lg:col-span-5 xl:col-span-4 flex flex-col items-center lg:items-stretch gap-5 sm:gap-6">

            {/* Pokémon Card — centered, capped at 320 px */}
            <div class="w-full flex justify-center">
              <PokemonAgentCard />
            </div>

            {/* Equipment slots */}
            <div class="card bg-base-100 border border-base-content/10 w-full">
              <div class="flex justify-between items-center px-3 sm:px-4 py-2 border-b border-base-content/10">
                <span class="text-[10px] font-bold uppercase tracking-widest text-primary">Equipment_Slots</span>
                <div class="badge badge-success badge-xs font-bold">LVL. 42</div>
              </div>
              <div class="card-body p-3 sm:p-4">
                <div class="grid grid-cols-5 gap-2 sm:gap-3">
                  <For each={equipSlots}>
                    {(slot) => <EquipSlotCard slot={slot} />}
                  </For>
                </div>
              </div>
            </div>

            {/* Data log */}
            <div class="card bg-base-100 border border-base-content/10 w-full relative">
              <div class="absolute top-0 left-4 -translate-y-1/2 bg-base-100 px-2 text-[10px] font-bold text-base-content/40 uppercase tracking-widest">
                Data_Log
              </div>
              <div class="card-body p-3 sm:p-4 pt-5">
                <textarea
                  class="textarea textarea-ghost w-full text-xs leading-relaxed text-success font-mono h-20 resize-none p-0 focus:outline-none"
                  spellcheck={false}
                  value={dataLog()}
                  onInput={(e) => setDataLog(e.currentTarget.value)}
                />
              </div>
            </div>
          </aside>

          {/* ── Right column ── */}
          <section class="lg:col-span-7 xl:col-span-8 flex flex-col gap-5 sm:gap-6">

            {/* Core Directives */}
            <div class="card bg-base-100 border border-base-content/10">
              <div class="flex justify-between items-center px-3 sm:px-4 py-2 border-b border-base-content/10 bg-base-200/40">
                <h2 class="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                  <span class="w-2 h-2 bg-primary rounded-full animate-pulse shrink-0" />
                  Core_Directives
                </h2>
                <span class="badge badge-ghost badge-xs font-bold uppercase tracking-wider">Mode: Read_Write</span>
              </div>
              <div class="card-body p-3 sm:p-4">
                <textarea
                  class="textarea textarea-bordered w-full text-xs sm:text-sm font-mono min-h-[100px] sm:min-h-[120px] focus:textarea-primary resize-none"
                  placeholder="Input system core logic..."
                  value={systemPrompt()}
                  onInput={(e) => setSystemPrompt(e.currentTarget.value)}
                />
              </div>
            </div>

            {/* Inventory Matrix */}
            <div class="card bg-base-100 border border-base-content/10">
              <div class="card-body p-3 sm:p-4 flex flex-col gap-4">
                {/* Tabs */}
                <div class="flex flex-wrap justify-between items-end border-b border-base-content/10 pb-3 gap-2">
                  <h2 class="text-xs sm:text-sm font-bold uppercase tracking-widest">Inventory_Matrix</h2>
                  <div class="flex gap-1">
                    <For each={tabs}>
                      {(tab) => (
                        <button
                          onClick={() => setActiveTab(tab)}
                          class={`btn btn-xs uppercase tracking-wider font-bold ${activeTab() === tab ? "btn-primary" : "btn-ghost border border-base-content/15"}`}
                        >
                          {tab}
                        </button>
                      )}
                    </For>
                  </div>
                </div>

                {/* Grid — responsive columns */}
                <div class="grid grid-cols-5 sm:grid-cols-6 md:grid-cols-7 lg:grid-cols-6 xl:grid-cols-8 gap-1.5 sm:gap-2">
                  <For each={gridItems}>
                    {(item) => <GridItemSlot item={item} />}
                  </For>
                </div>

                {/* Item detail */}
                <div class="border border-base-content/10 bg-base-200/50 p-2.5 sm:p-3 flex gap-3 sm:gap-4">
                  <div class="w-10 h-10 sm:w-12 sm:h-12 border border-primary flex items-center justify-center bg-primary/5 shrink-0">
                    <span class="material-symbols-outlined text-primary text-base sm:text-xl">bolt</span>
                  </div>
                  <div class="min-w-0">
                    <div class="text-[10px] text-primary font-bold uppercase tracking-tighter">EQUIPPED: GPT-4o</div>
                    <div class="text-[9px] text-base-content/40 font-medium truncate">OMNI-INTELLIGENT CORE / RA_LEVEL: EXTREME</div>
                    <div class="text-[9px] text-base-content/70 mt-1 italic line-clamp-2">"The peak of digital reasoning. Capable of multifaceted synthesis."</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Sync button */}
            <div class="flex justify-end">
              <button class="btn btn-primary w-full sm:w-auto px-8 sm:px-12 uppercase tracking-[0.15em] sm:tracking-[0.2em] shadow-[0_0_30px_oklch(var(--p)/.3)] hover:shadow-[0_0_50px_oklch(var(--p)/.5)] transition-all active:scale-95 overflow-hidden group relative">
                <span class="relative z-10">Synchronize_Agent</span>
                <div class="absolute inset-0 bg-white/20 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-in-out" />
              </button>
            </div>

          </section>
        </div>
      </main>

      {/* ── Mobile bottom nav ── */}
      <div class="btm-nav md:hidden z-50 border-t border-base-content/10">
        {(
          [
            { id: "unit", icon: "smart_toy", label: "UNIT" },
            { id: "inv", icon: "inventory_2", label: "INV" },
            { id: "log", icon: "terminal", label: "LOG" },
          ] as const
        ).map(({ id, icon, label }) => (
          <button onClick={() => setMobileTab(id)} class={mobileTab() === id ? "active" : ""}>
            <span class="material-symbols-outlined">{icon}</span>
            <span class="btm-nav-label text-[8px] font-bold uppercase">{label}</span>
          </button>
        ))}
      </div>

    </div>
  );
};

export default AgentHUD;
