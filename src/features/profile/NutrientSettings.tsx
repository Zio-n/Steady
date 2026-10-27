import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../app/AuthProvider';
import { queryKeys } from '../../data/queryKeys';
import { nextNutrientCreateRequest } from '../../domain/nutrientCreate';
import {
  archiveCustomNutrient,
  createCustomNutrient,
  reorderNutrientFields,
  updateNutrientField,
  type NutrientField,
} from '../../data/repositories/profileRepository';
import { Button } from '../../ui/components/Button';
import { Dialog } from '../../ui/components/Dialog';
import { StatusMessage } from '../../ui/components/StatusMessage';

export function NutrientSettings({ fields, onDirtyChange }: { fields: NutrientField[]; onDirtyChange: (dirty: boolean) => void }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [nameEdits, setNameEdits] = useState<Record<string, string>>({});
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const createRequestRef = useRef<{ signature: string; fieldId: string } | null>(null);
  const orderedFields = [...fields].sort((left, right) => left.display_order - right.display_order || left.name.localeCompare(right.name));
  const refresh = () => userId ? queryClient.invalidateQueries({ queryKey: queryKeys.profile(userId) }) : Promise.resolve();

  const createMutation = useMutation({
    mutationFn: (values: { fieldId: string; name: string; unit: string }) => createCustomNutrient(userId!, values.fieldId, values.name, values.unit, fields.length),
    onSuccess: async () => { createRequestRef.current = null; setName(''); setUnit(''); setFormError(''); setNotice('Custom nutrient added. Its unit is fixed to preserve meaning in saved history.'); await refresh(); },
    onError: () => { setFormError('We couldn’t confirm that nutrient was added. After reconnecting, check the list. If it is absent, retry the unchanged details in this open tab to avoid a duplicate.'); void refresh(); },
  });
  const updateMutation = useMutation({
    mutationFn: (input: { field: NutrientField; changes: Pick<NutrientField, 'name' | 'is_displayed' | 'display_order'> }) =>
      updateNutrientField(userId!, input.field.field_id, input.changes),
    onSuccess: async () => { setFormError(''); setNotice('Nutrient settings saved. Existing target snapshots retain their original labels and units.'); await refresh(); },
    onError: () => setFormError('We couldn’t update that nutrient. Refresh and try again.'),
  });
  const reorderMutation = useMutation({
    mutationFn: reorderNutrientFields,
    onSuccess: async () => { setFormError(''); await refresh(); },
    onError: () => setFormError('The nutrient order changed elsewhere. Refresh before trying again.'),
  });
  const archiveMutation = useMutation({
    mutationFn: (fieldId: string) => archiveCustomNutrient(userId!, fieldId),
    onSuccess: async () => { setArchiveId(null); setNotice('Nutrient archived. Its definition remains available to saved history.'); await refresh(); },
    onError: () => setFormError('We couldn’t archive that nutrient. Refresh and try again.'),
  });

  const hasNameDraft = orderedFields.some((field) => (nameEdits[field.field_id] ?? field.name) !== field.name);
  const isDirty = Boolean(name.trim() || unit.trim() || hasNameDraft || createMutation.isPending || updateMutation.isPending || reorderMutation.isPending || archiveMutation.isPending);
  useEffect(() => { onDirtyChange(isDirty); }, [isDirty, onDirtyChange]);

  function submitCustomField(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = name.trim();
    const normalizedUnit = unit.trim();
    setFormError('');
    setNotice('');
    if (!normalizedName || normalizedName.length > 80 || !normalizedUnit || normalizedUnit.length > 24) {
      setFormError('Enter a nutrient name (1–80 characters) and unit (1–24 characters).');
      return;
    }
    createRequestRef.current = nextNutrientCreateRequest(createRequestRef.current, normalizedName, normalizedUnit, () => crypto.randomUUID());
    createMutation.mutate({ fieldId: createRequestRef.current.fieldId, name: normalizedName, unit: normalizedUnit });
  }

  function toggleDisplayed(field: NutrientField, isDisplayed: boolean) {
    if (!userId) return;
    updateMutation.mutate({ field, changes: { name: field.name, is_displayed: isDisplayed, display_order: field.display_order } });
  }

  function saveName(field: NutrientField) {
    if (!userId) return;
    const nextName = (nameEdits[field.field_id] ?? field.name).trim();
    if (!nextName || nextName.length > 80) {
      setFormError('Nutrient names must be between 1 and 80 characters.');
      return;
    }
    updateMutation.mutate({ field, changes: { name: nextName, is_displayed: field.is_displayed, display_order: field.display_order } });
    setNameEdits((current) => ({ ...current, [field.field_id]: nextName }));
  }

  function moveField(fieldIndex: number, direction: -1 | 1) {
    const destination = fieldIndex + direction;
    if (destination < 0 || destination >= orderedFields.length) return;
    const reordered = [...orderedFields];
    const [field] = reordered.splice(fieldIndex, 1);
    reordered.splice(destination, 0, field);
    reorderMutation.mutate(reordered.map((item) => item.field_id));
  }

  const fieldToArchive = orderedFields.find((field) => field.field_id === archiveId);

  return (
    <section className="profile-section nutrient-settings" aria-labelledby="nutrient-settings-heading">
      <div className="profile-section-heading"><h2 id="nutrient-settings-heading">Nutrient settings</h2></div>
      <p className="field-hint">Choose what appears in your summaries and arrange its order. Field units never change; create a new field if the unit should differ.</p>
      {formError && <StatusMessage tone="error">{formError}</StatusMessage>}
      {notice && <StatusMessage tone="success">{notice}</StatusMessage>}
      <ol className="nutrient-settings-list">
        {orderedFields.map((field, index) => {
          const editedName = nameEdits[field.field_id] ?? field.name;
          const isRenamed = editedName.trim() !== field.name;
          return (
            <li className="nutrient-setting-row" key={field.field_id}>
              <div className="nutrient-setting-main">
                <label className="nutrient-display" htmlFor={`show-${field.field_id}`}>
                  <input id={`show-${field.field_id}`} type="checkbox" checked={field.is_displayed} onChange={(event) => toggleDisplayed(field, event.target.checked)} />
                  <span>{field.name}</span>
                </label>
                <span className="nutrient-unit">{field.unit}{field.standard_key ? ' · standard' : ' · custom'}</span>
              </div>
              <div className="nutrient-setting-actions">
                <Button variant="secondary" type="button" aria-label={`Move ${field.name} up`} disabled={index === 0 || reorderMutation.isPending} onClick={() => moveField(index, -1)}>↑</Button>
                <Button variant="secondary" type="button" aria-label={`Move ${field.name} down`} disabled={index === orderedFields.length - 1 || reorderMutation.isPending} onClick={() => moveField(index, 1)}>↓</Button>
              </div>
              {!field.standard_key && <div className="nutrient-custom-edit">
                <label className="visually-hidden" htmlFor={`rename-${field.field_id}`}>Rename {field.name}</label>
                <input id={`rename-${field.field_id}`} className="text-field" maxLength={80} value={editedName} onChange={(event) => setNameEdits((current) => ({ ...current, [field.field_id]: event.target.value }))} />
                <Button variant="secondary" type="button" disabled={!isRenamed || updateMutation.isPending} onClick={() => saveName(field)}>Save name</Button>
                <Button variant="secondary" type="button" onClick={() => setArchiveId(field.field_id)}>Archive</Button>
              </div>}
            </li>
          );
        })}
      </ol>
      <form className="custom-nutrient-form" onSubmit={submitCustomField}>
        <h3>Add a custom nutrient</h3>
        <div className="custom-nutrient-inputs">
          <label className="form-field" htmlFor="custom-nutrient-name"><span className="field-label">Name</span><input id="custom-nutrient-name" className="text-field" maxLength={80} value={name} disabled={createMutation.isPending} onChange={(event) => setName(event.target.value)} placeholder="e.g. Water" /></label>
          <label className="form-field" htmlFor="custom-nutrient-unit"><span className="field-label">Unit</span><input id="custom-nutrient-unit" className="text-field" maxLength={24} value={unit} disabled={createMutation.isPending} onChange={(event) => setUnit(event.target.value)} placeholder="e.g. ml" /></label>
        </div>
        <Button type="submit" variant="secondary" disabled={createMutation.isPending}>{createMutation.isPending ? 'Adding…' : 'Add nutrient'}</Button>
      </form>
      <Dialog open={Boolean(fieldToArchive)} title="Archive this nutrient?" onClose={() => setArchiveId(null)}>
        <p>{fieldToArchive?.name} will disappear from future entry and display choices. Its ID, unit and saved target snapshots remain available to history.</p>
        <div className="dialog-actions"><Button variant="secondary" type="button" onClick={() => setArchiveId(null)}>Keep nutrient</Button><Button type="button" disabled={archiveMutation.isPending} onClick={() => archiveId && archiveMutation.mutate(archiveId)}>Archive nutrient</Button></div>
      </Dialog>
    </section>
  );
}
