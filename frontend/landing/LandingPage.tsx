import { useRef, useState } from "react";

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={diagonal ? "M6 18 18 6M6 6h12v12" : "M4 12h15m-6-6 6 6-6 6"} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function MailIcon() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" strokeWidth="1.6"/><path d="m4 7 8 6 8-6" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>;
}

function SheetIcon() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" strokeWidth="1.6"/><path d="M4 9h16M4 15h16M10 9v12" stroke="currentColor" strokeWidth="1.6"/></svg>;
}

function Brand() {
  return <span className="brand"><span className="brand-key">CTRL</span><span>Loop<span className="brand-dot">.</span></span></span>;
}

const stages = [
  { label: "Vendor confirmation", short: "Vendor confirmed", initials: "JL", sender: "Jamie Lee", role: "Vendor · Northline Textiles", subject: "PO #1042 — confirmed on our side", body: "Hi Alex, we’ve received PO #1042 for the Everyday Tote. Quantities and delivery details are confirmed. We’re ready to move forward.", time: "9:14 AM", stamp: "9/14/26 9:14 AM", row: 0, col: 0, cell: "C2" },
  { label: "Buyer approval", short: "Buyer approved", initials: "SK", sender: "Sam Kim", role: "Buyer · Studio Supply", subject: "Re: PO #1043 — approved to proceed", body: "Hi Alex, the updated sample for PO #1043 looks good. You have our approval to proceed with the Canvas Cap order. Thanks for coordinating!", time: "10:32 AM", stamp: "9/14/26 10:32 AM", row: 1, col: 1, cell: "D3" },
  { label: "Color approval", short: "Colors approved", initials: "MP", sender: "Morgan Park", role: "Buyer · Studio Supply", subject: "PO #1042 — the sage color is approved", body: "Hi Alex, we’ve reviewed the latest lab dip for PO #1042. The sage color is approved for the Everyday Tote. Please use this color for production.", time: "11:08 AM", stamp: "9/14/26 11:08 AM", row: 0, col: 2, cell: "E2" },
] as const;

function SampleDemo() {
  const [selected, setSelected] = useState(0);
  const [applied, setApplied] = useState<number[]>([]);
  const [source, setSource] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const email = stages[selected];
  const updated = applied.includes(selected);
  const sourceEmail = stages[source];
  function openSource(index: number) {
    setSource(index);
    dialog.current?.showModal();
  }

  return <section className="demo-section section-wrap" id="demo" aria-labelledby="demo-heading">
    <div className="section-kicker"><span className="status-dot" /> FOLLOW ONE UPDATE, FROM EMAIL TO WIP.</div>
    <div className="section-title-row"><h2 id="demo-heading">One email. The right cell.<br/><span className="serif">Everything in the loop.</span></h2><p>Follow a sample update from the inbox<br className="desktop-break"/> to a purchase order in your WIP.</p></div>
    <div className="demo-shell">
      <div className="demo-topbar"><span className="demo-label"><span className="status-dot"/> INTERACTIVE SAMPLE</span><span className="sample-note">Fictional data. Real idea.</span></div>
      <div className="scenario-controls" role="group" aria-label="Choose a sample email">
        {stages.map((stage, i) => <button type="button" key={stage.label} aria-pressed={selected === i} onClick={() => setSelected(i)}><span>0{i + 1}</span>{stage.label}</button>)}
      </div>
      <div className="demo-content">
        <div className="email-pane">
          <div className="pane-label"><MailIcon/><span>THE EMAIL THAT MOVES THINGS FORWARD</span></div>
          <div className="sample-email" key={selected}>
            <div className="email-sender"><span className="avatar">{email.initials}</span><div><strong>{email.sender}</strong><span>{email.role}</span></div><time>{email.time}</time></div>
            <h3>{email.subject}</h3><p>{email.body}</p><span className="email-signoff">Thanks,<br/>{email.sender.split(" ")[0]}</span>
            <div className="email-match"><span>↳</span> PO #{email.row === 0 ? "1042" : "1043"}<span className="match-separator">/</span>{email.short}</div>
          </div>
          <button className="button button-orange apply-button" type="button" disabled={updated} onClick={() => setApplied([...applied, selected])}>{updated ? "✓ Sample email applied" : "Apply sample email"}{!updated && <Arrow/>}</button>
        </div>
        <div className="loop-connector" aria-hidden="true"><span>↗</span><i/></div>
        <div className="sheet-pane">
          <div className="sheet-title"><span className="sheet-file-icon"><SheetIcon/></span><div><strong>Fall production WIP</strong><span>Your spreadsheet. Your process.</span></div><span className="file-tag">.xlsx</span></div>
          <div className="sheet-scroll" role="region" aria-label="Sample purchase order spreadsheet, scroll horizontally to see all stages" tabIndex={0}>
            <table className="sample-sheet"><caption className="sr-only">Sample WIP. Apply an email to stamp its purchase order and stage, then select the timestamp to read the source.</caption><thead><tr className="column-letters"><th/><th>A</th><th>B</th><th>C</th><th>D</th><th>E</th></tr><tr><th>1</th><th scope="col">PO #</th><th scope="col">Product</th><th scope="col">Vendor confirmed</th><th scope="col">Buyer approved</th><th scope="col">Colors approved</th></tr></thead><tbody>
              {["Everyday Tote", "Canvas Cap", "Studio Apron"].map((product, row) => <tr key={product}><td className="row-number">{row + 2}</td><th scope="row">{1042 + row}</th><td className="product-name">{product}</td>{[0, 1, 2].map(col => {
                const index = stages.findIndex(stage => stage.row === row && stage.col === col);
                const isApplied = applied.includes(index);
                return <td key={col} className={selected === index ? "selected-cell" : ""}>{isApplied ? <button className="timestamp" type="button" onClick={() => openSource(index)} aria-label={`Open sample source email for PO ${1042 + row}, ${stages[index].short}, ${stages[index].stamp}`}>{stages[index].stamp}<Arrow diagonal/></button> : <span className="pending-cell">—</span>}</td>;
              })}</tr>)}
            </tbody></table>
          </div>
          <div className="sheet-tab"><SheetIcon/>Production<span>+</span></div>
          <div className="demo-result" role="status" aria-live="polite"><span className={updated ? "result-symbol result-done" : "result-symbol"}>{updated ? "✓" : "↳"}</span><div><strong>{updated ? `${email.cell} updated. Context included.` : `Next stop: cell ${email.cell}.`}</strong><p>{updated ? "Click the orange timestamp to read the sample source email." : "Apply the sample email to add its receipt time to the matching stage."}</p></div></div>
          <button className="text-button reset-button" type="button" onClick={() => { setApplied([]); setSelected(0); }} disabled={applied.length === 0 && selected === 0}>↺ Reset sample</button>
        </div>
      </div>
      <div className="demo-footnote"><span>Designed to connect every update to its source.</span><span>This sample doesn’t connect to your inbox or change a file.</span></div>
    </div>
    <dialog ref={dialog} className="source-dialog" aria-labelledby="source-title" onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="dialog-header"><span className="demo-label">SAMPLE SOURCE EMAIL</span><button type="button" className="close-button" aria-label="Close sample email" onClick={() => dialog.current?.close()}>×</button></div>
      <h3 id="source-title">{sourceEmail.subject}</h3><div className="source-meta"><strong>{sourceEmail.sender}</strong><span>{sourceEmail.role}</span><span>To: Alex · Operations</span><span>Received {sourceEmail.stamp}</span></div><p>{sourceEmail.body}</p><p className="dialog-note">This is a fictional email. In the intended Gmail workflow, a timestamp links to the original email in a new Gmail tab.</p>
      <form method="dialog"><button className="button button-dark">Back to the WIP <Arrow/></button></form>
    </dialog>
  </section>;
}

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header"><div className="header-inner"><a href="#" aria-label="Ctrl Loop home"><Brand/></a><nav className={menuOpen ? "main-nav is-open" : "main-nav"} id="main-nav" aria-label="Main navigation"><a href="#how-it-works" onClick={() => setMenuOpen(false)}>How it works</a><a href="#your-workflow" onClick={() => setMenuOpen(false)}>Your workflow</a><a href="#questions" onClick={() => setMenuOpen(false)}>FAQs</a></nav><a className="button button-dark nav-cta" href="#demo">Try the sample <Arrow/></a><button type="button" className="menu-button" aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="main-nav" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? "×" : <span><i/><i/></span>}</button></div></header>
    <main id="main">
      <section className="hero">
        <div className="hero-grid" aria-hidden="true"/>
        <div className="hero-content"><div className="eyebrow"><span className="status-dot"/> KEEP THE WORK MOVING</div><h1>Your inbox moves fast.<br/>Your <span className="hero-wip">WIP<svg viewBox="0 0 220 14" preserveAspectRatio="none" aria-hidden="true"><path d="M3 10C64 1 154 1 216 7M25 13c69-5 133-4 167-1" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg></span> should too.</h1><p>Meet Ctrl Loop. Email-to-spreadsheet automation<br className="desktop-break"/> that keeps your purchase orders in the loop.</p><div className="hero-actions"><a className="button button-orange" href="#demo">Try the sample <Arrow/></a><a className="hero-secondary" href="#how-it-works">See how it works <span>↓</span></a></div><span className="hero-note">Your spreadsheet. Fewer updates by hand.</span></div>
        <div className="hero-visual" aria-label="Illustration: a color approval email becomes a linked timestamp in a WIP spreadsheet">
          <div className="floating-email"><div className="floating-label"><MailIcon/>INCOMING EMAIL<span>JUST IN</span></div><strong>Re: PO #1042 · Color approval</strong><p>“The sage color is approved.<br/>Let’s get this into production.”</p><div className="floating-sender"><span className="mini-avatar">MP</span>Morgan · Buyer<span>11:08 AM</span></div></div>
          <div className="flow-trail trail-left" aria-hidden="true"/><div className="ctrl-stamp" aria-hidden="true"><span>[ctrl]</span><svg viewBox="0 0 80 42" fill="none"><path d="M40 21C20-14-5 4 8 25c10 15 24 1 32-4 9-6 20-25 31-10 13 21-12 39-31 10Z" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/></svg></div><div className="flow-trail trail-right" aria-hidden="true"/>
          <div className="floating-sheet"><div className="floating-label"><SheetIcon/>FALL PRODUCTION WIP<span>↗</span></div><div className="mini-sheet"><span>PO #</span><span>Product</span><span>Colors approved</span><strong>1042</strong><strong>Everyday Tote</strong><strong className="mini-stamp">9/14/26 11:08 AM ↗</strong><span>1043</span><span>Canvas Cap</span><span>—</span><span>1044</span><span>Studio Apron</span><span>—</span></div><div className="mini-sheet-note"><span>✓</span> Right order. Right stage. Source attached.</div></div>
          <span className="visual-caption">FROM “DID ANYONE UPDATE THE SHEET?” TO DONE.</span>
        </div>
      </section>
      <div className="tools-strip section-wrap"><p>Built around the way<br/><strong>your team already works.</strong></p><div><span className="integration-mark excel-mark">X</span><span>Microsoft Excel <small>Initial focus</small></span></div><div><span className="integration-mark sheets-mark"><SheetIcon/></span><span>Google Sheets <small>Planned</small></span></div><div><span className="integration-mark mail-mark"><MailIcon/></span><span>Your inbox <small>Where the updates start</small></span></div></div>
      <section className="how-section section-wrap" id="how-it-works" aria-labelledby="how-heading"><div className="section-kicker">LESS ADMIN. MORE MOMENTUM.</div><h2 id="how-heading">You run the orders.<br/><span className="serif">Let the updates follow.</span></h2><p className="section-intro">The approval is in an email. The status lives in a spreadsheet.<br className="desktop-break"/> Ctrl Loop is being built to close the gap.</p><div className="steps-grid">
        <article><div className="step-top"><span>01 / START WITH YOUR WIP</span><SheetIcon/></div><h3>Keep your sheet.</h3><p>The plan: upload your Excel WIP or connect a Google Sheet. Keep the purchase orders, contacts, and stages your team understands.</p><div className="step-visual file-visual" aria-hidden="true"><span className="integration-mark excel-mark">X</span><div><strong>Your very specific WIP.xlsx</strong><span>One row. One purchase order.</span></div><span>↗</span></div></article>
        <article><div className="step-top"><span>02 / LET THE EMAIL FIND ITS PLACE</span><MailIcon/></div><h3>Catch the update.</h3><p>A vendor confirms. A buyer approves. Ctrl Loop’s job is to understand the email and match it to the right PO and stage.</p><div className="step-visual match-visual" aria-hidden="true"><span>“PO #1042 is approved”</span><span>↳ <b>1042</b> <i>Buyer approved</i></span></div></article>
        <article><div className="step-top"><span>03 / KEEP THE CONTEXT</span><Arrow diagonal/></div><h3>Follow the source.</h3><p>A receipt timestamp in the right cell, linked to the email behind it. See what changed, when it arrived, and who said it.</p><div className="step-visual cell-visual" aria-hidden="true"><span>BUYER APPROVED</span><strong>9/14/26 10:32 AM <Arrow diagonal/></strong><small>One click back to the conversation.</small></div></article>
      </div></section>
      <SampleDemo/>
      <section className="workflow-section section-wrap" id="your-workflow" aria-labelledby="workflow-heading"><div className="workflow-copy"><div className="section-kicker">YOUR PROCESS DOESN’T COME IN A TEMPLATE.</div><h2 id="workflow-heading">Different customers.<br/>Different stages.<br/><span className="serif">Still your WIP.</span></h2><p>You’re the link between the buyer and the vendor. You shouldn’t have to be the link between every email and every cell, too.</p><p>Ctrl Loop is designed around the columns and milestones that matter to your business.</p><a className="inline-link" href="#demo">Find your moment in the sample <Arrow/></a></div><div className="workflow-board"><div className="workflow-board-top"><span className="mini-brand">[CTRL] Loop</span><span>YOUR WORKFLOW</span></div><div className="workflow-track"><span className="track-dot">1</span><div><small>FIRST THINGS FIRST</small><strong>Vendor confirmation</strong></div><span className="track-check">✓</span></div><div className="workflow-track"><span className="track-dot">2</span><div><small>GIVE IT THE GREEN LIGHT</small><strong>Buyer approval</strong></div><span className="track-check">✓</span></div><div className="workflow-track active-track"><span className="track-dot">3</span><div><small>GET THE DETAILS RIGHT</small><strong>Color approval</strong></div><span className="active-mail"><MailIcon/></span></div><div className="workflow-track future-track"><span className="track-dot">+</span><div><small>WHATEVER COMES NEXT</small><strong>Your next milestone</strong></div></div><div className="workflow-board-note"><span>↳</span>Your stages. Your order of operations.</div></div></section>
      <section className="future-section section-wrap"><div><span className="pill">ON THE HORIZON</span><h2>Keep people in the loop, too.</h2></div><p>Next, we’re exploring custom workflows: the right follow-up to the right person when a stage changes. Email sending and workflow customization are planned, and aren’t part of this sample.</p></section>
      <section className="faq-section section-wrap" id="questions" aria-labelledby="faq-heading"><div><div className="section-kicker">A FEW THINGS, UNPACKED.</div><h2 id="faq-heading">Good questions.<br/><span className="serif">Straight answers.</span></h2></div><div className="faq-list">
        <details><summary>What exactly is a WIP?<span>+</span></summary><p>Your work-in-progress spreadsheet: one row per purchase order, with columns for the people, dates, and stages involved. It’s the sheet everyone checks to see where things stand.</p></details>
        <details><summary>Can I use my existing spreadsheet?<span>+</span></summary><p>That’s the idea. Ctrl Loop is being built around the WIP you already use, starting with uploaded Excel workbooks. Google Sheets support is planned. You won’t need to upload anything to try this page’s sample.</p></details>
        <details><summary>What goes into an updated cell?<span>+</span></summary><p>The date and time the relevant email was received, linked to its source. The sample shows this with fictional emails. The intended Gmail workflow opens the original email in a new Gmail tab when you click the timestamp.</p></details>
        <details><summary>What if each customer has different stages?<span>+</span></summary><p>That’s why your sheet is the starting point. The intended workflow follows your purchase orders and your stage columns, whether that means vendor confirmation, buyer approval, color approval, or another milestone.</p></details>
        <details><summary>Does Ctrl Loop send emails for me?<span>+</span></summary><p>Sending selected emails based on workflow stages is a future direction. This landing page only demonstrates incoming email updates and doesn’t send messages or connect to a mailbox.</p></details>
        <details><summary>Can I connect my inbox or sign up here?<span>+</span></summary><p>Not yet. This is a product preview with an interactive sample. It uses fictional data and doesn’t collect your email, access your inbox, or change your spreadsheets.</p></details>
      </div></section>
      <section className="closing-section"><div className="closing-loop" aria-hidden="true">∞</div><div className="section-kicker">LESS CHASING. MORE MOVING.</div><h2>Keep your WIP<br/><span className="serif">in the loop.</span></h2><p>See what happens when your inbox<br/>and your spreadsheet are on the same page.</p><a className="button button-orange" href="#demo">Try the sample <Arrow/></a><span className="closing-note">No signup. Just a little “oh, that makes sense.”</span></section>
    </main>
    <footer className="site-footer section-wrap"><a href="#" aria-label="Ctrl Loop home"><Brand/></a><p>Work in progress. Under control.</p><a href="#questions">Product preview <Arrow diagonal/></a><span>© 2026 Ctrl Loop</span></footer>
  </>;
}
