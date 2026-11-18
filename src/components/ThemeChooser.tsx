import { Check } from "lucide-react";
import { classicThemes, extraThemes, type Theme } from "../core/themes";

const groups: { id: string; label: string; choices: { id: Theme; name: string }[] }[] = [
  {
    id: "classic-themes",
    label: "Classiques",
    choices: (Object.keys(classicThemes) as (keyof typeof classicThemes)[])
      .map(id => ({ id, name: classicThemes[id] })),
  },
  {
    id: "extra-themes",
    label: "Variations",
    choices: (Object.keys(extraThemes) as (keyof typeof extraThemes)[])
      .map(id => ({ id, name: extraThemes[id].name })),
  },
];

export default function ThemeChooser({ selected, onChoose }: { selected: Theme; onChoose: (theme: Theme) => void }) {
  return groups.map(({ id, label, choices }) => (
    <div key={id} className="theme-group" role="group" aria-labelledby={id}>
      <h4 id={id}>{label}</h4>
      <div className="theme-grid">
        {choices.map(({ id, name }) => (
          <button key={id} type="button" aria-pressed={selected === id}
            onClick={() => { if (selected !== id) onChoose(id); }}>
            <span className="theme-preview" data-theme={id} aria-hidden="true">
              <span />
              <span />
              <span />
              {selected === id && <Check size={15} />}
            </span>
            <span>{name}</span>
          </button>
        ))}
      </div>
    </div>
  ));
}
