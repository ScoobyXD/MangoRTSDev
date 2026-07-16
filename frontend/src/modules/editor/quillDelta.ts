import DeltaPackage from "quill-delta";

export type AttributeMap = Record<string, unknown>;
export type EditorDeltaOp = {
  insert?: string | Record<string, unknown>;
  delete?: number;
  retain?: number | Record<string, unknown>;
  attributes?: AttributeMap;
};
export type EditorDeltaShape = { ops: EditorDeltaOp[] };

export type EditorDeltaInstance = {
  ops: EditorDeltaOp[];
  insert(value: string | Record<string, unknown>, attributes?: AttributeMap): EditorDeltaInstance;
  compose(other: EditorDeltaInstance): EditorDeltaInstance;
  diff(other: EditorDeltaInstance): EditorDeltaInstance;
  transform(other: EditorDeltaInstance, priority?: boolean): EditorDeltaInstance;
  length(): number;
};

type EditorDeltaConstructor = new (input?: EditorDeltaShape | EditorDeltaOp[]) => EditorDeltaInstance;

const Delta = DeltaPackage as unknown as EditorDeltaConstructor;

export default Delta;
