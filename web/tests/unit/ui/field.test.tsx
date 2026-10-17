import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

describe("Field", () => {
  it("renders the label wired to the control via labelFor/id", () => {
    render(
      <Field label="Endpoint URL" labelFor="url">
        <Input id="url" />
      </Field>,
    );
    expect(
      screen.getByRole("textbox", { name: "Endpoint URL" }),
    ).toBeInTheDocument();
  });

  it("renders a field-scoped error in role=alert and omits the help text", () => {
    render(
      <Field
        label="Endpoint URL"
        labelFor="url"
        error="URL must start with https://"
        help="This should not render while an error is present"
      >
        <Input id="url" />
      </Field>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("URL must start with https://");
    expect(
      screen.queryByText("This should not render while an error is present"),
    ).not.toBeInTheDocument();
  });

  it("falls back to help text when there is no error", () => {
    render(
      <Field label="Asset" labelFor="asset" help="Pick the asset to watch">
        <Input id="asset" />
      </Field>,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Pick the asset to watch")).toBeInTheDocument();
  });
});
