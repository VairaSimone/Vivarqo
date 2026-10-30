import * as React from "react";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string };

export function Button({ children, variant = "secondary", className = "", ...props }: ButtonProps) {
  return <button className={["button", variant, className].filter(Boolean).join(" ")} {...props}>{children}</button>;
}

export type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "name" | "type" | "defaultValue"> & {
  label: string; name: string; type?: React.HTMLInputTypeAttribute; defaultValue?: string | number | null;
};

export function Input({ label, name, type = "text", defaultValue = "", required = false, ...props }: InputProps) {
  return <label className="field"><span>{label}</span><input name={name} type={type} defaultValue={defaultValue ?? ""} required={required} {...props} /></label>;
}

export type TextAreaProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "name" | "defaultValue"> & {
  label: string; name: string; defaultValue?: string | null;
};

export function TextArea({ label, name, defaultValue, rows = 3, ...props }: TextAreaProps) {
  return <label className="field"><span>{label}</span><textarea name={name} defaultValue={defaultValue ?? ""} rows={rows} {...props} /></label>;
}

export type SelectOption = readonly string[] | { value: string; label: string };
export type SelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "name" | "defaultValue"> & {
  label: string; name: string; defaultValue?: string | number | null; options: ReadonlyArray<SelectOption>;
};

export function Select({ label, name, defaultValue, options, ...props }: SelectProps) {
  return <label className="field"><span>{label}</span><select name={name} defaultValue={defaultValue ?? ""} {...props}>
    {options.map((option) => {
      const isObjectOption = "value" in option;
      const value = isObjectOption ? option.value : option[0];
      const text = isObjectOption ? option.label : option[1];
      return <option value={value} key={value}>{text}</option>;
    })}
  </select></label>;
}

export type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & { label: string; children?: React.ReactNode };
export function Field({ label, children, ...props }: FieldProps) {
  return <label className="field"><span>{label}</span>{children ?? <input {...props} />}</label>;
}

export type SelectFieldProps = React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; children?: React.ReactNode };
export function SelectField({ label, children, ...props }: SelectFieldProps) {
  return <label className="field"><span>{label}</span><select {...props}>{children}</select></label>;
}

export const Area = TextArea;
export const Choice = Select;
export const Action = Button;

export function SectionTitle({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return <div className="panel-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><div className="inline-actions">{children}</div></div>;
}
