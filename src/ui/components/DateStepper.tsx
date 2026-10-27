import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

type DateStepperProps = {
  label: string;
  todayLabel: string;
  onPrevious: () => void;
  onToday: () => void;
  onNext: () => void;
};

export function DateStepper({ label, todayLabel, onPrevious, onToday, onNext }: DateStepperProps) {
  return (
    <div className="date-actions" aria-label="Choose a date">
      <button className="icon-button" type="button" aria-label="Previous day" onClick={onPrevious}><ChevronLeft size={19} /></button>
      <button className="date-button" type="button" aria-label={todayLabel} onClick={onToday}><CalendarDays size={16} /><span>{label}</span></button>
      <button className="icon-button" type="button" aria-label="Next day" onClick={onNext}><ChevronRight size={19} /></button>
    </div>
  );
}
