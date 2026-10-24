"use client";
import { useState } from "react";
import type { SpaceDraft } from "./space-form";
export function useLayoutState() {
  const [workZoneFormId, setWorkZoneFormId] = useState<string | null>(null);
  const [selectedWorkZoneId, setSelectedWorkZoneId] = useState<string | null>(
    null,
  );
  const [spaceResizeId, setSpaceResizeId] = useState<string | null>(null);
  const [spaceFormId, setSpaceFormId] = useState<string | null>(null);
  const [spaceDraft, setSpaceDraft] = useState<SpaceDraft | undefined>(
    undefined,
  );
  const [drawKind, setDrawKind] = useState<"room" | "corridor" | null>(null);
  const [locationFormId, setLocationFormId] = useState<string | null>(null);
  const [sectionFormId, setSectionFormId] = useState<string | null>(null);
  const [sectionCopyId, setSectionCopyId] = useState<string | null>(null);
  const [sectionCopyPosition, setSectionCopyPosition] = useState({
    x: 0,
    y: 0,
  });
  const [addLevelSectionId, setAddLevelSectionId] = useState<string | null>(
    null,
  );
  const [aisleFormId, setAisleFormId] = useState<string | null>(null);
  const [entranceFormId, setEntranceFormId] = useState<string | null>(null);
  const [planSettingsOpen, setPlanSettingsOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [labelId, setLabelId] = useState<string | null>(null);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(
    null,
  );
  return {
    workZoneFormId,
    setWorkZoneFormId,
    selectedWorkZoneId,
    setSelectedWorkZoneId,
    spaceResizeId,
    setSpaceResizeId,
    spaceFormId,
    setSpaceFormId,
    spaceDraft,
    setSpaceDraft,
    drawKind,
    setDrawKind,
    aisleFormId,
    setAisleFormId,
    entranceFormId,
    setEntranceFormId,
    planSettingsOpen,
    setPlanSettingsOpen,
    trashOpen,
    setTrashOpen,
    locationFormId,
    setLocationFormId,
    sectionFormId,
    setSectionFormId,
    sectionCopyId,
    setSectionCopyId,
    sectionCopyPosition,
    setSectionCopyPosition,
    addLevelSectionId,
    setAddLevelSectionId,
    labelId,
    setLabelId,
    selectedAddressId,
    setSelectedAddressId,
  };
}
