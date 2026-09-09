import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { NumberField, OptionalNumberField } from "./number-field";

function Controlled({ onCommit }: { onCommit: (value: number) => void }) {
  const [value, setValue] = useState(0.5);
  return (
    <NumberField
      label="Limiar"
      onCommit={(next) => {
        setValue(next);
        onCommit(next);
      }}
      step={0.01}
      value={value}
    />
  );
}

function ControlledOptional({ onCommit }: { onCommit: (value: number | undefined) => void }) {
  const [value, setValue] = useState<number | undefined>(0.7);
  return (
    <OptionalNumberField
      label="Temperatura"
      onCommit={(next) => {
        setValue(next);
        onCommit(next);
      }}
      step={0.1}
      value={value}
    />
  );
}

describe("NumberField", () => {
  it("publishes a valid number as it is typed", async () => {
    const onCommit = vi.fn();
    render(<Controlled onCommit={onCommit} />);
    const field = screen.getByLabelText("Limiar");
    await userEvent.clear(field);
    await userEvent.type(field, "0.7");
    expect(onCommit).toHaveBeenLastCalledWith(0.7);
  });

  it("lets the field sit empty without publishing anything", async () => {
    const onCommit = vi.fn();
    render(<Controlled onCommit={onCommit} />);
    const field = screen.getByLabelText("Limiar");
    await userEvent.clear(field);
    expect(field).toHaveValue(null);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("keeps a half-typed decimal on screen", async () => {
    render(<Controlled onCommit={vi.fn()} />);
    const field = screen.getByLabelText("Limiar");
    await userEvent.clear(field);
    await userEvent.type(field, "0.");
    expect(field).toHaveValue(0);
  });

  it("follows a value changed by the parent", async () => {
    function Parent() {
      const [value, setValue] = useState(1);
      return (
        <>
          <NumberField label="Limiar" onCommit={setValue} value={value} />
          <button onClick={() => setValue(9)} type="button">
            definir
          </button>
        </>
      );
    }
    render(<Parent />);
    await userEvent.click(screen.getByRole("button", { name: "definir" }));
    expect(screen.getByLabelText("Limiar")).toHaveValue(9);
  });
});

describe("OptionalNumberField", () => {
  it("treats an empty field as unset", async () => {
    const onCommit = vi.fn();
    render(<ControlledOptional onCommit={onCommit} />);
    await userEvent.clear(screen.getByLabelText("Temperatura"));
    expect(onCommit).toHaveBeenLastCalledWith(undefined);
  });

  it("publishes a number once one is typed", async () => {
    const onCommit = vi.fn();
    render(<ControlledOptional onCommit={onCommit} />);
    const field = screen.getByLabelText("Temperatura");
    await userEvent.clear(field);
    await userEvent.type(field, "1.2");
    expect(onCommit).toHaveBeenLastCalledWith(1.2);
  });

  it("starts empty when nothing is set", () => {
    render(<OptionalNumberField label="Seed" onCommit={vi.fn()} value={undefined} />);
    expect(screen.getByLabelText("Seed")).toHaveValue(null);
  });
});
