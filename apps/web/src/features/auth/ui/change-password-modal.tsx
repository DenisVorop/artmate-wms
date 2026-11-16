"use client";
import { useState } from "react";
import { Modal } from "@/shared/ui";
import { PasswordChangeForm } from "./password-change-form";
export function ChangePasswordModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title="Сменить пароль"
    >
      {open && <PasswordChangeForm onDone={onClose} onBusyChange={setBusy} />}
    </Modal>
  );
}
