import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { unguardedHoverClasses } from "../tests/test-utils";
import { Select, type SelectOption } from "./select";

const languages: readonly SelectOption<string>[] = [
  { label: "auto", value: "auto" },
  { label: "en", value: "en" },
  { label: "pl", value: "pl" },
  { label: "pt", value: "pt" },
  { label: "pt-BR", value: "pt-BR" },
];

function Harness({
  initial = "en",
  onChange = () => undefined,
  options = languages,
}: {
  initial?: string;
  onChange?: (value: string) => void;
  options?: readonly SelectOption<string>[];
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <Select
        aria-label="Idioma"
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
        options={options}
        value={value}
      />
      <button type="button">Depois</button>
    </>
  );
}

describe("Select", () => {
  it("shows the selected option on a closed combobox", () => {
    render(<Harness />);
    const combobox = screen.getByRole("combobox", { name: "Idioma" });
    expect(combobox).toHaveTextContent("en");
    expect(combobox).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("opens on click and marks the selected option", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("combobox", { name: "Idioma" }));
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox", { name: "Idioma" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "en" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: "pl" })).toHaveAttribute("aria-selected", "false");
  });

  it("picks an option with the pointer, closes and keeps focus on the combobox", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const combobox = screen.getByRole("combobox", { name: "Idioma" });
    await userEvent.click(combobox);
    await userEvent.click(screen.getByRole("option", { name: "pt-BR" }));
    expect(onChange).toHaveBeenCalledWith("pt-BR");
    expect(combobox).toHaveTextContent("pt-BR");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(combobox).toHaveFocus();
  });

  it("does not report a change when the current option is picked again", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole("combobox", { name: "Idioma" }));
    await userEvent.click(screen.getByRole("option", { name: "en" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("moves through the options with the keyboard and confirms with Enter", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const combobox = screen.getByRole("combobox", { name: "Idioma" });
    combobox.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(combobox).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: "en" }).id,
    );
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}");
    expect(combobox).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: "pl" }).id,
    );
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("pl");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("jumps to the ends with Home and End and stops at the edges", async () => {
    render(<Harness />);
    const combobox = screen.getByRole("combobox", { name: "Idioma" });
    combobox.focus();
    await userEvent.keyboard("{ArrowDown}{End}{ArrowDown}");
    expect(combobox).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: "pt-BR" }).id,
    );
    await userEvent.keyboard("{Home}{ArrowUp}");
    expect(combobox).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: "auto" }).id,
    );
  });

  it("opens with Space and confirms with Space", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    screen.getByRole("combobox", { name: "Idioma" }).focus();
    await userEvent.keyboard(" ");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await userEvent.keyboard("{ArrowDown} ");
    expect(onChange).toHaveBeenCalledWith("pl");
  });

  it("closes with Escape without changing the value", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const combobox = screen.getByRole("combobox", { name: "Idioma" });
    combobox.focus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(combobox).toHaveFocus();
  });

  it("commits the highlighted option when Tab leaves an open list", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    screen.getByRole("combobox", { name: "Idioma" }).focus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    await userEvent.tab();
    expect(onChange).toHaveBeenCalledWith("pl");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Depois" })).toHaveFocus();
  });

  it("jumps to the option that starts with the typed characters", async () => {
    render(<Harness />);
    const combobox = screen.getByRole("combobox", { name: "Idioma" });
    combobox.focus();
    await userEvent.keyboard("pt-");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(combobox).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: "pt-BR" }).id,
    );
  });

  it("cycles through options sharing the same first letter", async () => {
    render(<Harness />);
    const combobox = screen.getByRole("combobox", { name: "Idioma" });
    combobox.focus();
    await userEvent.keyboard("{ArrowDown}");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await userEvent.keyboard("p");
      expect(combobox).toHaveAttribute(
        "aria-activedescendant",
        screen.getByRole("option", { name: "pl" }).id,
      );
      vi.advanceTimersByTime(1000);
      await userEvent.keyboard("p");
      expect(combobox).toHaveAttribute(
        "aria-activedescendant",
        screen.getByRole("option", { name: "pt" }).id,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("highlights the option under the pointer", async () => {
    render(<Harness />);
    const combobox = screen.getByRole("combobox", { name: "Idioma" });
    await userEvent.click(combobox);
    await userEvent.hover(screen.getByRole("option", { name: "pt" }));
    expect(combobox).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: "pt" }).id,
    );
  });

  it("closes when focus moves elsewhere", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("combobox", { name: "Idioma" }));
    await userEvent.click(screen.getByRole("button", { name: "Depois" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("toggles closed on a second click", async () => {
    render(<Harness />);
    const combobox = screen.getByRole("combobox", { name: "Idioma" });
    await userEvent.click(combobox);
    await userEvent.click(combobox);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("stays closed while disabled", async () => {
    render(
      <Select
        aria-label="Tag"
        disabled
        onChange={() => undefined}
        options={languages}
        value="en"
      />,
    );
    await userEvent.click(screen.getByRole("combobox", { name: "Tag" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("does not react to hover while disabled", () => {
    render(<Harness />);
    expect(unguardedHoverClasses(screen.getByRole("combobox", { name: "Idioma" }))).toEqual([]);
  });

  it("renders leading content next to each option and the selected value", async () => {
    render(
      <Select
        aria-label="Participante"
        onChange={() => undefined}
        options={[
          { label: "Qualquer", value: "" },
          { label: "PixelPaladin", leading: <span data-testid="avatar-u1" />, value: "u1" },
        ]}
        value="u1"
      />,
    );
    expect(screen.getByTestId("avatar-u1")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("combobox", { name: "Participante" }));
    expect(screen.getAllByTestId("avatar-u1")).toHaveLength(2);
  });

  it("lets the caller draw the closed value", () => {
    render(
      <Select
        aria-label="Idioma do dashboard"
        onChange={() => undefined}
        options={[{ label: "English", value: "en" }]}
        renderValue={(option) => option?.value.toUpperCase()}
        value="en"
        variant="toolbar"
      />,
    );
    expect(screen.getByRole("combobox", { name: "Idioma do dashboard" })).toHaveTextContent("EN");
  });

  it("stays usable when the value is missing from the options", async () => {
    const onChange = vi.fn();
    render(<Harness initial="gone" onChange={onChange} />);
    const combobox = screen.getByRole("combobox", { name: "Idioma" });
    combobox.focus();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("auto");
  });

  it("opens on the matching edge with Home, End and ArrowUp", async () => {
    render(<Harness />);
    const combobox = screen.getByRole("combobox", { name: "Idioma" });
    combobox.focus();
    const activeName = () =>
      document.getElementById(combobox.getAttribute("aria-activedescendant") ?? "")?.textContent;
    await userEvent.keyboard("{End}");
    expect(activeName()).toBe("pt-BR");
    await userEvent.keyboard("{Escape}{Home}");
    expect(activeName()).toBe("auto");
    await userEvent.keyboard("{Escape}{ArrowUp}");
    expect(activeName()).toBe("en");
  });

  it("pages through long lists and commits with Alt+ArrowUp", async () => {
    const onChange = vi.fn();
    const many = Array.from({ length: 25 }, (_, index) => ({
      label: `Opção ${String(index)}`,
      value: `o${String(index)}`,
    }));
    render(<Harness initial="o0" onChange={onChange} options={many} />);
    screen.getByRole("combobox", { name: "Idioma" }).focus();
    await userEvent.keyboard("{ArrowDown}{PageDown}{PageDown}{PageDown}{PageUp}");
    await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
    expect(onChange).toHaveBeenCalledWith("o14");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("commits with Alt+ArrowDown", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    screen.getByRole("combobox", { name: "Idioma" }).focus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Alt>}{ArrowDown}{/Alt}");
    expect(onChange).toHaveBeenCalledWith("pl");
  });

  it("treats Space as part of a label while typing", async () => {
    const onChange = vi.fn();
    render(
      <Harness
        initial="tag"
        onChange={onChange}
        options={[
          { label: "Sem tag", value: "tag" },
          { label: "Semana", value: "week" },
          { label: "Sem fórum", value: "forum" },
        ]}
      />,
    );
    screen.getByRole("combobox", { name: "Idioma" }).focus();
    // Without the space in the search, it would confirm "Semana" instead.
    await userEvent.keyboard("sem f{Enter}");
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("forum");
  });

  it("scrolls the list to keep the highlighted option visible", async () => {
    const many = Array.from({ length: 6 }, (_, index) => ({
      label: `Opção ${String(index)}`,
      value: `o${String(index)}`,
    }));
    render(<Harness initial="o0" options={many} />);
    await userEvent.click(screen.getByRole("combobox", { name: "Idioma" }));
    const list = screen.getByRole("listbox");
    // jsdom has no layout, so the list geometry is stubbed.
    Object.defineProperty(list, "clientHeight", { configurable: true, value: 60 });
    Object.defineProperty(list, "scrollTop", { configurable: true, value: 0, writable: true });
    for (const [index, option] of screen.getAllByRole("option").entries()) {
      Object.defineProperty(option, "offsetTop", { configurable: true, value: index * 30 });
      Object.defineProperty(option, "offsetHeight", { configurable: true, value: 30 });
    }
    await userEvent.keyboard("{End}");
    expect(list.scrollTop).toBe(120);
    await userEvent.keyboard("{Home}");
    expect(list.scrollTop).toBe(0);
  });

  it("ignores keys while the list has no options", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} options={[]} />);
    screen.getByRole("combobox", { name: "Idioma" }).focus();
    await userEvent.keyboard("{ArrowDown}{Enter}a");
    expect(onChange).not.toHaveBeenCalled();
  });
});
