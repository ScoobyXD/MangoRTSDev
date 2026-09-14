import { useEffect, useState } from "react";
import { APIHTTPError } from "../../modules/api/requestJSON.js";
import { getCtrlLoopSourceEmail, type CtrlLoopSourceEmail } from "../../modules/ctrl-loop/ctrlLoopApi.js";
import type { CtrlLoopEmailTarget } from "../../modules/ctrl-loop/ctrlLoopEmailRoute.js";
import { EmailReferencePreviewModal } from "../home/HomeParts.js";
import { sanitizeForwardedEmailHTML } from "../home/emailForwarding.js";

export function CtrlLoopEmailPreview({ target, onClose }: { target: CtrlLoopEmailTarget; onClose: () => void }) {
  const [source, setSource] = useState<CtrlLoopSourceEmail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const sourcePath = `/ctrl-loop/email/${target.companyID}/${target.emailThreadID}/${target.emailMessageID}`;
    const previousPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (previousPath === sourcePath) return;
    // Keep refresh and AuthGate's session-expiry return on this exact email while the table stays mounted.
    window.history.replaceState(window.history.state, "", sourcePath);
    return () => {
      if (`${window.location.pathname}${window.location.search}${window.location.hash}` === sourcePath) window.history.replaceState(window.history.state, "", previousPath);
    };
  }, [target.companyID, target.emailThreadID, target.emailMessageID]);
  useEffect(() => {
    const controller = new AbortController();
    setSource(null); setError(""); setLoading(true);
    void getCtrlLoopSourceEmail(target, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        const body = result.message.body ?? "";
        setSource({ ...result, message: { ...result.message, body: /<\/?[a-z][\s\S]*>/i.test(body) ? sanitizeForwardedEmailHTML(body) : body } });
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof APIHTTPError && (cause.status === 403 || cause.status === 404)
          ? "This source email is unavailable or you do not have access to its mailbox."
          : cause instanceof Error ? cause.message : "Could not load this source email.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [target.companyID, target.emailThreadID, target.emailMessageID]);

  return <EmailReferencePreviewModal
    message={source?.message ?? null} threadMessages={source ? [source.message] : []}
    singleMessage resources={[]} nodes={[]} companyID={target.companyID} accountEmail={source?.account_email}
    loading={loading} error={error}
    onLoadMessageBody={async (id) => source?.message.id === id ? source.message : null}
    onOpenNode={() => undefined} onOpenLogicGate={() => undefined} onClose={onClose}
  />;
}

export function CtrlLoopEmailRoute({ target, onClose }: { target: CtrlLoopEmailTarget; onClose: () => void }) {
  useEffect(() => {
    const previous = document.title;
    document.title = "Source email · [CTRL] Loop";
    return () => { document.title = previous; };
  }, []);
  return <main style={{ minHeight: "100dvh", background: "#f2f4f8" }} aria-label="[CTRL] Loop source email">
    <CtrlLoopEmailPreview key={`${target.companyID}/${target.emailThreadID}/${target.emailMessageID}`} target={target} onClose={onClose} />
  </main>;
}
