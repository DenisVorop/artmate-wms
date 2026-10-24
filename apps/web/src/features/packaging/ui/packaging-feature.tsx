"use client";
import { usePackagingState } from "../lib/use-packaging-state";
import { Box, Settings2 } from "lucide-react";
import { useWorkspace } from "@/entities/workspace";
import { Button } from "@/shared/ui";
import { PackagingForm } from "./packaging-form";
export function PackagingFeature() {
  const { data } = useWorkspace();
  const { selectedId, setSelectedId } = usePackagingState();
  if (!data) return null;
  const selected = data.skus.find((s) => s.id === selectedId);
  return (
    <section
      className="ops-profile-block"
      id="packaging-profiles"
      aria-label="Профили упаковки"
    >
      <div className="page-header">
        <div>
          <p className="eyebrow">ГАБАРИТЫ И УКЛАДКА</p>
          <h2 className="section-title">Профили упаковки</h2>
          <p className="page-description">
            Вместимость считается по размерам упаковки и схеме укладки.
          </p>
        </div>
      </div>
      <div className="ops-profile-grid">
        {data.skus.map((s) => {
          const p = s.packaging;
          return (
            <article key={s.id} className="glass-panel ops-panel">
              <div className="ops-profile-title">
                <h3>
                  <Box size={16} /> {s.name}
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedId(s.id)}
                  aria-label={`Настроить упаковку ${s.name}`}
                >
                  <Settings2 size={15} />
                  Настроить
                </Button>
              </div>
              <div className="ops-profile-facts">
                <div>
                  <span>Короб, Ш × Г × В</span>
                  <strong>
                    {p.boxWidthMm} × {p.boxDepthMm} × {p.boxHeightMm} мм
                  </strong>
                </div>
                <div>
                  <span>Схема укладки</span>
                  <strong>
                    {p.boxesPerLayer} × {p.maxLayers} ={" "}
                    {p.boxesPerLayer * p.maxLayers} коробов
                  </strong>
                </div>
                <div>
                  <span>Поддон</span>
                  <strong>
                    {p.palletWidthMm} × {p.palletDepthMm} мм
                  </strong>
                </div>
                <div>
                  <span>Предельная высота</span>
                  <strong>
                    {p.palletBaseHeightMm + p.maxLayers * p.boxHeightMm} мм
                  </strong>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {selected && (
        <PackagingForm
          key={selected.id}
          sku={selected}
          onClose={() => setSelectedId(null)}
        />
      )}
    </section>
  );
}
