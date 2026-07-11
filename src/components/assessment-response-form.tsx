"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getAssessmentGuidance } from "@/features/assessment/domain/guidance";

type Answer = "yes" | "partially" | "no" | "not_applicable";
type Question = {
  id: string;
  code: string;
  prompt: string;
  position: number;
  categoryCode: string;
  categoryTitle: string;
  categoryPosition: number;
};
type Response = { question_id: string; answer: string | null; evidence_note: string };
type Draft = { answer: Answer | null; evidenceNote: string };
type SaveResult = "saved" | "failed" | "conflict" | "missing-answer";
type SaveState = "idle" | "saving" | "saved" | "failed" | "conflict";

const answers: Array<{ value: Answer; label: string; summary: string; consequence: string }> = [
  { value: "yes", label: "Yes", summary: "Consistently in place", consequence: "This records the practice as in place. Add useful evidence so the position is easy to review later." },
  { value: "partially", label: "Partially", summary: "Some foundations exist", consequence: "This records a partial position and creates follow-up from the remaining gap. Note what already works and what is missing." },
  { value: "no", label: "No", summary: "Not in place yet", consequence: "This records a gap for downstream follow-up. The next step is to describe the current position without trying to solve it here." },
  { value: "not_applicable", label: "Not applicable", summary: "Outside your current context", consequence: "This records the question as not applicable. Add the business reason so that decision can be reviewed later." },
];

function snapshotKey(questionId: string, draft: Draft) {
  return `${questionId}\u0000${draft.answer ?? ""}\u0000${draft.evidenceNote}`;
}

export function AssessmentResponseList({ sessionId, questions, initialRevision, responses }: {
  sessionId: string;
  questions: Question[];
  initialRevision: number;
  responses: Response[];
}) {
  const router = useRouter();
  const [activeIndex, setActiveIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(questions.map((question) => {
    const response = responses.find((item) => item.question_id === question.id);
    const answer = answers.some((item) => item.value === response?.answer) ? response?.answer as Answer : null;
    return [question.id, { answer, evidenceNote: response?.evidence_note ?? "" }];
  })));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [validationMessage, setValidationMessage] = useState("");
  const revision = useRef(initialRevision);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const conflict = useRef(false);
  const persisted = useRef<Record<string, Draft>>(Object.fromEntries(questions.map((question) => {
    const response = responses.find((item) => item.question_id === question.id);
    const answer = answers.some((item) => item.value === response?.answer) ? response?.answer as Answer : null;
    return [question.id, { answer, evidenceNote: response?.evidence_note ?? "" }];
  })));
  const pending = useRef(new Map<string, Promise<SaveResult>>());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousIndex = useRef(0);

  const sections = useMemo(() => questions.reduce<Array<{ code: string; title: string; count: number; position: number }>>((result, question) => {
    const section = result.find((item) => item.code === question.categoryCode);
    if (section) section.count += 1;
    else result.push({ code: question.categoryCode, title: question.categoryTitle, count: 1, position: question.categoryPosition });
    return result;
  }, []).sort((a, b) => a.position - b.position), [questions]);

  useEffect(() => {
    if (previousIndex.current !== activeIndex) {
      headingRef.current?.focus();
      previousIndex.current = activeIndex;
    }
  }, [activeIndex]);

  if (questions.length === 0) return <p className="assessment-empty">No published assessment questions are available.</p>;

  const question = questions[activeIndex];
  const draft = drafts[question.id];
  const guidance = getAssessmentGuidance(question.code);
  const selectedAnswer = answers.find((answer) => answer.value === draft.answer);
  const sectionQuestions = questions.filter((item) => item.categoryCode === question.categoryCode);
  const sectionIndex = sectionQuestions.findIndex((item) => item.id === question.id);
  const answeredCount = Object.values(drafts).filter((item) => item.answer !== null).length;
  const sectionAnswered = sectionQuestions.filter((item) => drafts[item.id]?.answer !== null).length;

  function setDraft(questionId: string, next: Draft) {
    setDrafts((current) => ({ ...current, [questionId]: next }));
    setValidationMessage("");
  }

  function enqueueSave(questionId: string, snapshot: Draft): Promise<SaveResult> {
    if (!snapshot.answer) return Promise.resolve("missing-answer");
    if (conflict.current) return Promise.resolve("conflict");
    if (snapshotKey(questionId, persisted.current[questionId]) === snapshotKey(questionId, snapshot)) return Promise.resolve("saved");

    const key = snapshotKey(questionId, snapshot);
    const existing = pending.current.get(key);
    if (existing) return existing;

    setSaveState("saving");
    const operation = queue.current.then(async (): Promise<SaveResult> => {
      if (conflict.current) return "conflict";
      if (snapshotKey(questionId, persisted.current[questionId]) === key) return "saved";
      setSaveState("saving");
      try {
        const result = await fetch("/api/app/assessment/response", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, questionId, answer: snapshot.answer, evidenceNote: snapshot.evidenceNote, expectedRevision: revision.current }),
        });
        if (!result.ok) {
          if (result.status === 409) {
            conflict.current = true;
            setSaveState("conflict");
            return "conflict";
          }
          setSaveState("failed");
          return "failed";
        }
        const body = await result.json();
        revision.current = body.revision;
        persisted.current[questionId] = snapshot;
        setSaveState("saved");
        return "saved";
      } catch {
        setSaveState("failed");
        return "failed";
      }
    });
    queue.current = operation.then(() => undefined);
    pending.current.set(key, operation);
    void operation.finally(() => {
      if (pending.current.get(key) === operation) pending.current.delete(key);
    });
    return operation;
  }

  async function flush(action: "continue" | "finish") {
    if (!draft.answer) {
      setValidationMessage("Choose an answer before saving this question.");
      return;
    }
    const result = await enqueueSave(question.id, { ...draft });
    if (result !== "saved") return;
    if (action === "finish") {
      router.push("/app/assessment");
    } else if (activeIndex < questions.length - 1) {
      setActiveIndex((index) => index + 1);
    } else {
      router.push("/app/assessment");
    }
  }

  const saveLabel = saveState === "idle" ? "" : saveState === "saving" ? "Saving" : saveState === "saved" ? "Saved" : saveState === "conflict" ? "Conflict" : "Failed";

  return <section className="assessment-workspace" aria-label="Guided assessment">
    <div className="assessment-progress-summary">
      <div><span>Overall progress</span><strong>{answeredCount} of {questions.length} answered</strong></div>
      <progress value={answeredCount} max={questions.length}>Question completion</progress>
      <div><span>{question.categoryTitle}</span><strong>{sectionAnswered} of {sectionQuestions.length} answered</strong></div>
      <progress value={sectionAnswered} max={sectionQuestions.length}>Section completion</progress>
    </div>

    <div className="assessment-guided-layout">
      <nav className="assessment-section-outline" aria-label="Assessment sections">
        <h2>Sections</h2>
        <ol>{sections.map((section) => <li key={section.code} data-active={section.code === question.categoryCode}>
          <span>{section.title}</span><small>{section.count} {section.count === 1 ? "question" : "questions"}</small>
        </li>)}</ol>
      </nav>

      <article className="assessment-question-panel">
        <header className="assessment-question-header">
          <div><span>{question.categoryTitle}</span><strong>Question {activeIndex + 1} of {questions.length}</strong></div>
          <p>Question {sectionIndex + 1} of {sectionQuestions.length} in this section</p>
          <h2 ref={headingRef} tabIndex={-1}>{question.code}: {question.prompt}</h2>
        </header>

        <div className="assessment-guidance">
          <section><h3>Why it matters</h3><p>{guidance.whyItMatters}</p></section>
          <section><h3>A practical startup baseline</h3><p>{guidance.startupBaseline}</p></section>
        </div>

        <fieldset className="assessment-answers" role="radiogroup">
          <legend>Your answer</legend>
          {answers.map((answer) => <label key={answer.value} data-selected={draft.answer === answer.value}>
            <input type="radio" aria-label={answer.label} name={`answer-${question.id}`} value={answer.value} checked={draft.answer === answer.value} onChange={() => {
              const next = { ...draft, answer: answer.value };
              setDraft(question.id, next);
              void enqueueSave(question.id, next);
            }} />
            <span><strong>{answer.label}</strong><small>{answer.summary}</small></span>
          </label>)}
        </fieldset>

        {selectedAnswer && <p className="assessment-consequence" role="status" aria-label="Answer consequence"><strong>What this means:</strong> {selectedAnswer.consequence}</p>}

        <section className="assessment-evidence-examples">
          <h3>Evidence you could use</h3>
          <p>These are suggestions, not a required checklist.</p>
          <ul aria-label="Suggested evidence examples">{guidance.evidenceExamples.map((example) => <li key={example}>{example}</li>)}</ul>
        </section>

        <label className="assessment-evidence-note">
          <span>Evidence note <small>Optional, up to 10,000 characters</small></span>
          <textarea aria-label="Evidence note" maxLength={10_000} value={draft.evidenceNote} onChange={(event) => setDraft(question.id, { ...draft, evidenceNote: event.target.value })} onBlur={() => { if (draft.answer) void enqueueSave(question.id, { ...draft }); }} placeholder="Summarise what you have and where it can be found" />
        </label>

        {validationMessage && <p className="assessment-message assessment-message--risk" role="alert">{validationMessage}</p>}
        {saveState === "conflict" && <div className="assessment-message assessment-message--risk" role="alert"><strong>Conflict:</strong> This assessment changed elsewhere. Reload before saving or continuing. <button type="button" onClick={() => window.location.reload()}>Reload assessment</button></div>}
        {saveState === "failed" && <div className="assessment-message assessment-message--attention"><span>The last save failed. Your draft remains on this page.</span> <button type="button" onClick={() => { void enqueueSave(question.id, { ...draft }); }}>Retry save</button></div>}

        <footer className="assessment-actions">
          <button className="button secondary" type="button" disabled={activeIndex === 0} onClick={() => setActiveIndex((index) => Math.max(0, index - 1))}>Previous</button>
          <div>
            <button className="button secondary" type="button" onClick={() => { void flush("finish"); }}>Save and finish later</button>
            <button className="button primary" type="button" onClick={() => { void flush("continue"); }}>{activeIndex === questions.length - 1 ? "Save and complete" : "Save and continue"}</button>
          </div>
        </footer>
      </article>
    </div>

    <span className="sr-only" role="status" aria-label="Save status" aria-live="polite">{saveLabel}</span>
    <span className="sr-only" role="status" aria-label="Question progress announcement" aria-live="polite">Question {activeIndex + 1} of {questions.length}. {question.categoryTitle}.</span>
  </section>;
}
