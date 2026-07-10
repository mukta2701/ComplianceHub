import type { ReactNode } from "react";

export type PageHeadingProps = {
  eyebrow?: string;
  title: string;
  body: ReactNode;
  metadata?: ReactNode;
  action?: ReactNode;
};

export function PageHeading({ eyebrow, title, body, metadata, action }: PageHeadingProps) {
  return (
    <header className="page-heading">
      <div className="page-heading__content">
        {eyebrow ? <span className="page-heading__eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        <p>{body}</p>
        {metadata ? <div className="page-heading__metadata">{metadata}</div> : null}
      </div>
      {action ? <div className="page-heading__action">{action}</div> : null}
    </header>
  );
}
