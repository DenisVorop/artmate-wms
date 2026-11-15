"use client";

import { useWorkspace } from "@/entities/workspace";
import { Button } from "@/shared/ui";
import { usePackagingState } from "../lib/use-packaging-state";
import { PackagingForm } from "./packaging-form";
import styles from "./packaging.module.css";

export function PackagingFeature() {
  const { data } = useWorkspace();
  const { selectedId, setSelectedId } = usePackagingState();
  if (!data) return null;
  const skus = [...data.skus].sort((a, b) =>
    a.name.localeCompare(b.name, "ru"),
  );
  const selected = skus.find((sku) => sku.id === selectedId);

  return (
    <section id="packaging-profiles" aria-label="Профили упаковки">
      {skus.length ? (
        <div
          className={styles.scroll}
          role="region"
          aria-label="Таблица упаковки"
          tabIndex={0}
        >
          <table className={styles.table}>
            <thead>
              <tr>
                {[
                  "Товар",
                  "Короб, мм",
                  "Поддон, мм",
                  "Груз с поддоном, мм",
                  "Укладка",
                  "Действие",
                ].map((label) => (
                  <th key={label} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {skus.map((sku) => {
                const profile = sku.packaging;
                return (
                  <tr key={sku.id}>
                    <th scope="row">{sku.name}</th>
                    <td className={styles.dimensions}>
                      {profile.boxWidthMm} × {profile.boxDepthMm} ×{" "}
                      {profile.boxHeightMm}
                    </td>
                    <td className={styles.dimensions}>
                      {profile.palletWidthMm} × {profile.palletDepthMm}
                    </td>
                    <td className={styles.dimensions}>
                      {profile.loadWidthMm ?? profile.palletWidthMm} ×{" "}
                      {profile.loadDepthMm ?? profile.palletDepthMm} ×{" "}
                      {profile.palletBaseHeightMm +
                        profile.maxLayers * profile.boxHeightMm}
                    </td>
                    <td className={styles.dimensions}>
                      {profile.boxesPerLayer} × {profile.maxLayers} ={" "}
                      {profile.boxesPerLayer * profile.maxLayers} кор.
                    </td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedId(sku.id)}
                        aria-label={`Настроить упаковку ${sku.name}`}
                      >
                        Настроить
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.empty}>Товаров нет</p>
      )}
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
