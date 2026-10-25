# Интеграции и план сборки

Пользователь выбрал Wildberries и Ozon, продажи со складов маркетплейсов (FBW/FBO). Требуется подключить продажи/остатки, сопоставить тематики и рассчитывать потребность сборки/поставки. Ключи вводятся пользователем в WMS; в чате и из соседнего проекта ключи не берутся.

Разделение: providers — официальные чтения; MarketplaceService/storage — encrypted credentials + sync snapshots + mapping; planning — объяснимый расчёт; features integration/planning и read entities — FSD. API Nest/Swagger → Orval.
