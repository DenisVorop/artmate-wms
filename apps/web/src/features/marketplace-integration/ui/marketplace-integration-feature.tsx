"use client";
import { useState } from "react";
import { useSession } from "@/entities/session";
import { useWorkspace } from "@/entities/workspace";
import { providerName, useMarketplaces } from "@/entities/marketplaces";
import { Button, ErrorState, LoadingState, Modal } from "@/shared/ui";
import { useIntegrationActions } from "../model/use-integration-actions";
import { connectionPayload, mappingPayload } from "../lib/integration-form";
import { ConnectionCard } from "./connection-card";
import { filterCatalog } from "../lib/catalog-view";
import { MarketplaceFilters } from "./marketplace-filters";
import { ProductMapping } from "./product-mapping";
import { ProductTable } from "./product-table";
import { SkuCreate } from "./sku-create";
import { SkuBarcodes } from "./sku-barcodes";
import { SupplyDocuments } from "./supply-documents";
import styles from "./marketplace-integration.module.css";

export function MarketplaceIntegrationFeature() {
  const session = useSession();
  const query = useMarketplaces(session.isManager);
  const workspace = useWorkspace();
  const actions = useIntegrationActions();
  const [notice, setNotice] = useState("");
  const [provider, setProvider] = useState("");
  const [search, setSearch] = useState("");
  const [mapping, setMapping] = useState("");
  const [supply, setSupply] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<{
    provider: string;
    externalId: string;
  } | null>(null);

  if (query.isPending)
    return <LoadingState label="Загружаем данные маркетплейсов…" />;
  if (!query.data) return <ErrorState onRetry={() => void query.refetch()} />;

  const data = query.data;
  const skus = workspace.data?.skus ?? [];
  const skuNames = new Map(skus.map((sku) => [sku.id, sku.name]));
  const filtered = filterCatalog(data.products, data.supplies, {
    provider,
    search,
    mapping,
    supply,
    skuNames,
  });
  const selected = data.products.find(
    (item) =>
      item.provider === selectedProduct?.provider &&
      item.externalId === selectedProduct.externalId,
  );
  const connected = data.connections.some(
    (connection) => connection.configured,
  );
  const missingSkuCount = data.products.filter((item) => !item.skuId).length;

  return (
    <div className={styles.feature}>
      <h1 className="page-heading">Маркетплейсы</h1>
      <section className={styles.connections} aria-label="Подключения">
        {data.connections.map((connection) => (
          <ConnectionCard
            key={connection.provider}
            connection={connection}
            pending={actions.pending}
            error={actions.error}
            onClearError={actions.clearError}
            onSave={async (values) => {
              const success = await actions.connect(
                connectionPayload(connection.provider, values),
              );
              if (success)
                setNotice(
                  `${providerName(connection.provider)}: подключение сохранено.`,
                );
              return success;
            }}
            onSync={async () => {
              setNotice("");
              return actions.sync(connection.provider);
            }}
            onToggle={async () => {
              const success = await actions.toggle(
                connection.provider,
                !connection.enabled,
              );
              if (success)
                setNotice(
                  `${providerName(connection.provider)}: ${connection.enabled ? "отключён" : "включён"}.`,
                );
              return success;
            }}
          />
        ))}
      </section>

      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {query.isError && (
        <div className={styles.readError} role="alert">
          Не удалось обновить данные маркетплейсов.
          <Button
            size="sm"
            variant="ghost"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Повторить
          </Button>
        </div>
      )}

      <MarketplaceFilters
        provider={provider}
        search={search}
        mapping={mapping}
        supply={supply}
        onProvider={setProvider}
        onSearch={setSearch}
        onMapping={setMapping}
        onSupply={setSupply}
      />
      <section
        className={styles.panel}
        aria-labelledby="marketplace-products-title"
      >
        <header className={styles.sectionHeading}>
          <h2 id="marketplace-products-title">
            Товары <small>{filtered.products.length}</small>
          </h2>
          {missingSkuCount > 0 && (
            <span className={styles.warning}>
              Без тематики: {missingSkuCount}
            </span>
          )}
        </header>
        {workspace.isError && !workspace.data && (
          <div
            className={`${styles.readError} ${styles.sectionHeading}`}
            role="alert"
          >
            Не удалось загрузить тематики склада.
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void workspace.refetch()}
            >
              Повторить
            </Button>
          </div>
        )}
        <ProductTable
          products={filtered.products}
          skuNames={skuNames}
          empty={
            data.products.length
              ? "По этим фильтрам товаров нет."
              : connected
                ? "Товары ещё не загружены."
                : "Подключите площадку, чтобы загрузить товары."
          }
          onSelect={(product) => {
            actions.clearError();
            setSelectedProduct({
              provider: product.provider,
              externalId: product.externalId,
            });
          }}
        />
        <SkuCreate
          disabled={!workspace.data}
          onCreated={(name) => setNotice(`Тематика «${name}» создана.`)}
        />
      </section>
      <SupplyDocuments
        supplies={filtered.supplies}
        empty={
          data.supplies.length
            ? "По этим фильтрам поставок нет."
            : "Поставок пока нет."
        }
      />
      {skus.length > 0 && <SkuBarcodes skus={skus} />}
      <Modal
        open={!!selected}
        title={selected?.name ?? "Товар"}
        onClose={() => {
          if (actions.pending) return;
          actions.clearError();
          setSelectedProduct(null);
        }}
      >
        {selected && (
          <ProductMapping
            key={`${selected.provider}:${selected.externalId}:${selected.skuId}:${selected.unitsPerItem}`}
            product={selected}
            skus={skus}
            pending={actions.pending}
            error={actions.error}
            onSave={async (values) => {
              const success = await actions.map(
                mappingPayload(selected, values),
              );
              if (success) {
                setNotice(`Тематика товара «${selected.name}» сохранена.`);
                setSelectedProduct(null);
              }
              return success;
            }}
          />
        )}
      </Modal>
    </div>
  );
}
