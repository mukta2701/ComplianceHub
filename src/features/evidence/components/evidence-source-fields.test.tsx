import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";

import { EvidenceSourceFields } from "./evidence-source-fields";

it("shows only the input used by the selected evidence source type", async () => {
  const user = userEvent.setup();
  render(<EvidenceSourceFields />);

  expect(screen.getByLabelText(/^File/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/^Web address/)).not.toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("Evidence type"), "link");
  expect(screen.queryByLabelText(/^File/)).not.toBeInTheDocument();
  expect(screen.getByLabelText(/^Web address/)).toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("Evidence type"), "note");
  expect(screen.queryByLabelText(/^File/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/^Web address/)).not.toBeInTheDocument();
  expect(screen.getByText(/recorded in the description above/i)).toBeInTheDocument();
});
