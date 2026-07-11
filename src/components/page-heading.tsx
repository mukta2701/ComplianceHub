import type { ReactNode } from "react";

export type PageHeadingProps = {
  eyebrow?: string;
  title: string;
  body: string;
  metadata?: ReactNode;
  action?: ReactNode;
  headingLevel?: 1 | 2;
};

export function PageHeading({
  eyebrow,
  title,
  body,
  metadata,
  action,
  headingLevel = 1,
}: PageHeadingProps) {
  const Heading = headingLevel === 1 ? "h1" : "h2";

  return (
    <header className="page-heading">
      <div className="page-heading__content">
        {eyebrow ? <span className="page-heading__eyebrow">{eyebrow}</span> : null}
        <Heading>{title}</Heading>
        <p>{body}</p>
        {metadata ? <div className="page-heading__metadata">{metadata}</div> : null}
      </div>
      {action ? <div className="page-heading__action">{action}</div> : null}
    </header>
  );
}
