import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useThemeControls } from "@/lib-theme/context.js";

export function ThemePicker() {
  const { active, available, setThemeId } = useThemeControls();
  return (
    <Select value={active.id} onValueChange={setThemeId}>
      <SelectTrigger className="w-40" data-testid="theme-picker" aria-label="Select theme">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {available.map((t) => (
          <SelectItem key={t.id} value={t.id} data-testid={`theme-option-${t.id}`}>
            {t.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
