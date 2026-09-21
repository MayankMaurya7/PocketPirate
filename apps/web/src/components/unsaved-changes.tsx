"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
} from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";

/**
 * Unsaved-changes guard. Forms report whether they hold unsaved input
 * (`useUnsavedChanges(dirty)`); anything that would throw that input away —
 * a tab or link (`GuardedLink`), sign out, closing the dialog the form
 * lives in, the form's own Cancel — first asks "Discard changes?" through
 * the one `ConfirmDialog` the provider renders. A reload or tab close while
 * something is dirty gets the browser's own prompt (`beforeunload`).
 *
 * Dirty forms are tracked per **scope**: the provider is the page-wide
 * scope, and a dialog (`ExpenseScreen`, `Modal`) opens a child scope around
 * its content, so closing the dialog asks only about the forms inside it
 * while a tab tap asks about every form on the page. A form unregisters
 * when it unmounts or turns clean, so a successful save never prompts.
 *
 * Not covered: the browser's Back button and programmatic `router.push`
 * (only used after a save).
 */

/** The dirty forms inside one part of the page. Never read during render. */
class Scope {
  private readonly ids = new Set<string>();

  constructor(
    private readonly parent: Scope | null,
    /** Called when the scope turns dirty (true) or clean (false). */
    private readonly onDirtyChange?: (dirty: boolean) => void,
  ) {}

  get dirty() {
    return this.ids.size > 0;
  }

  add(id: string) {
    const wasDirty = this.dirty;
    this.ids.add(id);
    if (!wasDirty) {
      this.onDirtyChange?.(true);
    }
    this.parent?.add(id);
  }

  remove(id: string) {
    if (this.ids.delete(id) && !this.dirty) {
      this.onDirtyChange?.(false);
    }
    this.parent?.remove(id);
  }
}

function onBeforeUnload(event: BeforeUnloadEvent) {
  // The browser shows its own generic "Leave site?" prompt.
  event.preventDefault();
}

const ScopeContext = createContext<Scope | null>(null);
const AskContext = createContext<((proceed: () => void) => void) | null>(null);

export function UnsavedChangesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Listening for `beforeunload` only while dirty: a permanent listener
  // costs the page its back/forward-cache eligibility in some browsers.
  const [root] = useState(
    () =>
      new Scope(null, (dirty) => {
        if (dirty) {
          window.addEventListener("beforeunload", onBeforeUnload);
        } else {
          window.removeEventListener("beforeunload", onBeforeUnload);
        }
      }),
  );
  // What to do once the person confirms; non-null = the dialog is open.
  const [proceed, setProceed] = useState<(() => void) | null>(null);
  // One dialog element per prompt. A <dialog>'s `close` event fires on a
  // later animation frame, so with a single reused element the event from
  // the previous prompt can land after the next one has opened and cancel
  // it; an unmounted element's event reaches nobody.
  const [prompts, setPrompts] = useState(0);

  const ask = useCallback((next: () => void) => {
    setProceed(() => next);
    setPrompts((count) => count + 1);
  }, []);

  return (
    <ScopeContext value={root}>
      <AskContext value={ask}>
        {children}
        <ConfirmDialog
          key={prompts}
          open={proceed !== null}
          onCancel={() => setProceed(null)}
          onConfirm={() => {
            setProceed(null);
            proceed?.();
          }}
          title="Discard changes?"
          description="You have unsaved changes. If you leave now, they will be lost."
          confirmLabel="Discard changes"
          cancelLabel="Keep editing"
        />
      </AskContext>
    </ScopeContext>
  );
}

/**
 * For a form: registers it as dirty while `dirty` is true, and returns
 * `confirmDiscard(proceed)` for its own Cancel button — `proceed` runs at
 * once when the form is clean, after "Discard changes" when it is not.
 */
export function useUnsavedChanges(dirty: boolean) {
  const scope = useContext(ScopeContext);
  const ask = useContext(AskContext);
  const id = useId();

  useEffect(() => {
    if (!dirty || !scope) {
      return;
    }
    scope.add(id);
    return () => scope.remove(id);
  }, [dirty, scope, id]);

  return useCallback(
    (proceed: () => void) => {
      if (dirty && ask) {
        ask(proceed);
      } else {
        proceed();
      }
    },
    [dirty, ask],
  );
}

/**
 * For whatever leaves the page or closes a container: `confirmLeave(proceed)`
 * runs `proceed` at once when no form in the scope is dirty, after "Discard
 * changes" otherwise. Pass a dialog's own scope (`useUnsavedScope`) to ask
 * only about the forms inside it; the default is the nearest scope.
 */
export function useGuard(scope?: Scope) {
  const nearest = useContext(ScopeContext);
  const ask = useContext(AskContext);
  const target = scope ?? nearest;

  return useCallback(
    (proceed: () => void) => {
      if (target?.dirty && ask) {
        ask(proceed);
      } else {
        proceed();
      }
    },
    [target, ask],
  );
}

/** For `GuardedLink`: a check, at event time, for any dirty form on the page. */
export function useHasUnsavedChanges() {
  const scope = useContext(ScopeContext);
  return useCallback(() => scope?.dirty ?? false, [scope]);
}

/**
 * For a dialog that hosts forms: a child scope to hand to `useGuard` and to
 * wrap the dialog's content in with `<UnsavedScope scope={scope}>`.
 */
export function useUnsavedScope() {
  const parent = useContext(ScopeContext);
  const [scope] = useState(() => new Scope(parent));
  return scope;
}

export function UnsavedScope({
  scope,
  children,
}: {
  scope: Scope;
  children: React.ReactNode;
}) {
  return <ScopeContext value={scope}>{children}</ScopeContext>;
}
