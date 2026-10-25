"use client";
import { useSession } from "@/entities/session";
import Link from "next/link";
import { Package, Layers, Search, ArrowUpRight, ScanLine } from "lucide-react";
import { useWorkspace } from "@/entities/workspace";
import { Badge, Button, Input, LoadingState, ErrorState } from "@/shared/ui";
import { number, date } from "@/shared/lib/format";
import { useInventoryFilter } from "../lib/use-inventory-filter";
import {
  isVisibleInventoryPallet,
  skuInventory,
} from "../lib/inventory-balance";
import { palletComposition, palletMatchesSkus } from "../lib/pallet-stock";
import { boxPlacement } from "../lib/box-placement";
import styles from "./inventory.module.css";
export function InventoryFeature({
  onCorrection,
}: {
  onCorrection?: () => void;
}) {
  const { isManager } = useSession();
  const { data, isPending, isError, refetch } = useWorkspace();
  const { search, setSearch, view, setView } = useInventoryFilter();
  if (isPending) return <LoadingState />;
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />;
  const balance = data.balance;
  const skus = data.skus.filter((s) =>
    `${s.name} ${s.code} ${s.barcode}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">ТОВАРНЫЙ УЧЁТ</p>
          <h1 className="page-heading">Остатки</h1>
          <p className="page-description">
            Общий баланс и остатки по тематикам, паллетам и коробам.
          </p>
        </div>
        <div className={styles.actions}>
          <Link href="/stocktakes" className="button button--secondary">
            Инвентаризация
          </Link>
          {isManager && (
            <Link href="/stock-ledger" className="button button--secondary">
              Журнал учёта
            </Link>
          )}
          {isManager && onCorrection && (
            <Button variant="secondary" onClick={onCorrection}>
              Корректировка
            </Button>
          )}
          <Link href="/receiving" className="button button--primary">
            К приёмкам <ArrowUpRight size={16} />
          </Link>
        </div>
      </div>
      <div className={`ops-metrics ${styles.metrics}`}>
        {[
          ["На балансе, шт.", number(balance.totalUnits)],
          ["До сборки, шт.", number(balance.rawUnits)],
          ["В сборке, шт.", number(balance.workInProgressUnits)],
          ["В готовых коробах, шт.", number(balance.boxedUnits)],
        ].map(([l, v]) => (
          <div className="glass-panel ops-metric" key={l}>
            <span>{l}</span>
            <strong>{v}</strong>
          </div>
        ))}
      </div>
      <section className="glass-panel ops-panel">
        <div className="ops-toolbar">
          <Search size={17} />
          <Input
            aria-label="Поиск тематики"
            placeholder="Тематика, артикул или штрихкод"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="ops-tabs" role="tablist" aria-label="Вид остатков">
            {[
              ["summary", "По тематикам"],
              ["pallets", "Паллеты"],
              ["boxes", "Короба"],
            ].map(([v, l]) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                className="ops-tab"
                onClick={() => setView(v)}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              {view === "summary" ? (
                <tr>
                  <th>Тематика</th>
                  <th>На балансе, шт.</th>
                  <th>До сборки, шт.</th>
                  <th>В сборке, шт.</th>
                  <th>В коробах, шт.</th>
                  <th>В резерве, шт.</th>
                  <th>На балансе, коробов</th>
                  <th>Упаковка</th>
                </tr>
              ) : view === "pallets" ? (
                <tr>
                  <th>Паллета</th>
                  <th>Тематика</th>
                  <th>Место</th>
                  <th>Количество</th>
                  <th>Поступление</th>
                  <th>Этикетка</th>
                </tr>
              ) : (
                <tr>
                  <th>Короб</th>
                  <th>Тематика</th>
                  <th>Состав</th>
                  <th>Место</th>
                  <th>Статус</th>
                  <th>Этикетка</th>
                </tr>
              )}
            </thead>
            <tbody>
              {view === "summary"
                ? skus.map((s) => {
                    const stock = skuInventory(data, s.id);
                    return (
                      <tr key={s.id}>
                        <td>
                          <div className="ops-sku">
                            <span
                              className="ops-swatch"
                              style={{
                                background: s.color + "20",
                                color: s.color,
                              }}
                            >
                              <Package size={17} />
                            </span>
                            <div>
                              {s.name}
                              <div className="ops-sub">{s.code}</div>
                            </div>
                          </div>
                        </td>
                        <td>{number(stock.totalUnits)}</td>
                        <td>{number(stock.rawUnits)}</td>
                        <td>{number(stock.workInProgressUnits)}</td>
                        <td>{number(stock.boxedUnits)}</td>
                        <td>{number(stock.reservedUnits)}</td>
                        <td>{number(stock.boxesCount)}</td>
                        <td>{s.unitsPerBox} шт. / короб</td>
                      </tr>
                    );
                  })
                : view === "pallets"
                  ? data.pallets
                      .filter(
                        (p) =>
                          isVisibleInventoryPallet(p) &&
                          palletMatchesSkus(
                            data,
                            p,
                            new Set(skus.map((s) => s.id)),
                            !search.trim(),
                          ),
                      )
                      .map((p) => (
                        <tr key={p.id}>
                          <td className="ops-mono">
                            {p.code}
                            <div className="ops-sub">
                              {p.status === "in_transit"
                                ? "В перемещении"
                                : p.status === "retired"
                                  ? "Снят с хранения"
                                  : p.quantity === 0
                                    ? "Пустой поддон на месте"
                                    : p.kind === "assembly"
                                      ? "На накоплении"
                                      : "На хранении"}
                            </div>
                          </td>
                          <td>
                            {p.kind === "assembly" ? (
                              <>
                                <strong>Общая паллета сборки</strong>
                                {palletComposition(data, p.id).map((row) => (
                                  <div className="ops-sub" key={row.skuId}>
                                    {row.name} · {row.boxes} кор. · {row.units}{" "}
                                    шт.
                                  </div>
                                ))}
                                {p.quantity === 0 && (
                                  <div className="ops-sub">Накопитель пуст</div>
                                )}
                              </>
                            ) : (
                              data.skus.find((s) => s.id === p.skuId)?.name
                            )}
                          </td>
                          <td>
                            {data.locations.find((l) => l.id === p.locationId)
                              ?.code ??
                              (p.status === "in_transit" ? "В пути" : "—")}
                          </td>
                          <td>
                            {number(p.quantity)}{" "}
                            {p.kind === "raw" ? "шт." : "кор."}
                          </td>
                          <td>
                            {data.lots.find((l) => l.id === p.lotId)?.receivedAt
                              ? date(
                                  data.lots.find((l) => l.id === p.lotId)!
                                    .receivedAt,
                                )
                              : p.kind === "assembly"
                                ? "Накопление после сборки"
                                : "Готовая продукция"}
                          </td>
                          <td>
                            <Link
                              aria-label={`Этикетка ${p.code}`}
                              href={`/labels/pallet/${p.id}`}
                              target="_blank"
                            >
                              <ScanLine size={16} />
                            </Link>
                          </td>
                        </tr>
                      ))
                  : data.boxes
                      .filter((b) => skus.some((s) => s.id === b.skuId))
                      .map((b) => {
                        const placement = boxPlacement(data, b);
                        return (
                          <tr key={b.id}>
                            <td className="ops-mono">{b.code}</td>
                            <td>
                              {data.skus.find((s) => s.id === b.skuId)?.name}
                            </td>
                            <td>
                              {b.lotContents
                                .map((l) => `${l.quantity} шт.`)
                                .join(" + ")}
                              {b.lotContents.length > 1 && (
                                <div className="ops-sub">Смешанный короб</div>
                              )}
                            </td>
                            <td>{placement.address}</td>
                            <td>
                              <Badge tone={placement.tone}>
                                {placement.status}
                              </Badge>
                            </td>
                            <td>
                              <Link
                                href={`/labels/box/${b.id}`}
                                target="_blank"
                                aria-label={`Этикетка ${b.code}`}
                              >
                                <ScanLine size={16} />
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
            </tbody>
          </table>
        </div>
        {skus.length === 0 && (
          <div className="ops-empty">
            <Layers size={24} /> Ничего не найдено
          </div>
        )}
      </section>
    </>
  );
}
