"use client";

import { useEffect, useRef, useState } from "react";
import {
  Apple, Archive, Armchair, Baby, Bath, Bean, BedDouble, Beef, Bike, Blender, BookOpen, Brush, Camera, Candy,
  ChevronLeft, ChevronRight, CircleDot, Coffee, Coins, Columns2, Cookie, CookingPot, Croissant, CupSoda, Dices, Drumstick,
  Dumbbell, EggFried, Fence, Fish, Flag, Flower2, Folder, Footprints, Gamepad2, Gem,
  Guitar, Hammer, Hand, HardHat, Headphones, HeartPulse, IceCreamBowl, Laptop, Layers, Lamp, LayoutGrid, Leaf, Mail, Milk,
  Music, Newspaper, Palette, PartyPopper, PawPrint, Plug, Puzzle, Rows2, Scissors, ScrollText, Search,
  Nut, Pizza, Salad, Sandwich, Shapes, Shirt, ShoppingBag, Smartphone, Snowflake, Soup, Sparkles, SprayCan, Stamp,
  Tablet, Target, Tent, Tv, UtensilsCrossed, Video, WashingMachine, Watch, Waves, Wheat, X,
} from "lucide-react";
import { ProductCard } from "@/components/ProductCard";
import type { Product, ProductCategory } from "@/data/products";
import { getCategoryBranchIds, getCategoryPath } from "@/lib/categories";

const categoryIcons: Record<string, typeof LayoutGrid> = {
  Clothing: Shirt, Shoes: Footprints, Bags: ShoppingBag, Accessories: Gem, Beauty: SprayCan, Grooming: SprayCan,
  "Designer women": Shirt, "Designer men": Shirt, "Girls clothing": Shirt, "Boys clothing": Shirt,
  Toys: Shapes, "Pushchairs, carriers & car seats": Baby, "Furniture & decor": Armchair,
  "Bathing & changing": Bath, "Childproofing & safety equipment": Fence, "Health & pregnancy": HeartPulse,
  "Nursing & feeding": Milk, "Sleep & bedding": BedDouble, "School supplies": BookOpen, "Other kids' items": Shapes,
  "Small kitchen appliances": Blender, "Large appliances": WashingMachine, "Cookware & bakeware": CookingPot,
  "Kitchen tools": UtensilsCrossed, Tableware: Soup, "Household care": Brush, Textiles: Layers,
  "Home accessories": Lamp, "Office supplies": Folder, "Celebrations & holidays": PartyPopper,
  "Tools & DIY": Hammer, "Outdoor & garden": Flower2, Furniture: Armchair, "Pet care": PawPrint,
  "Video games & consoles": Gamepad2, "Computers & accessories": Laptop, "Mobile phones & communication": Smartphone,
  "Audio, headphones & hi-fi": Headphones, "Cameras & accessories": Camera, "Tablets, e-readers & accessories": Tablet,
  "TV & home cinema": Tv, "Beauty & personal care electronics": Scissors, Wearables: Watch, "Other devices & accessories": Plug,
  Books: BookOpen, Magazines: Newspaper, Music, Video, "Trading cards": Layers, "Board games": Dices,
  Puzzles: Puzzle, "Tabletop & miniature gaming": LayoutGrid, Memorabilia: ScrollText, "Coins & banknotes": Coins,
  Stamps: Stamp, Postcards: Mail, "Musical instruments & gear": Guitar, "Arts & crafts": Palette,
  "Collectables storage": Archive, "Gaming accessories": Dices, Cycling: Bike, "Fitness, running & yoga": Dumbbell,
  "Outdoor sports": Tent, "Water sports": Waves, "Team sports": CircleDot, "Racket sports": Target,
  Golf: Flag, Equestrian: HardHat, "Skateboards & scooters": Footprints, "Boxing & martial arts": Hand,
  "Casual sports & games": Dices, "Winter sports": Snowflake,
  Pizza, Burgers: Sandwich, "Fried chicken": Drumstick, "Shawarma & kebabs": Sandwich,
  "Arabic & Middle Eastern": UtensilsCrossed, Turkish: UtensilsCrossed, Indian: UtensilsCrossed, Chinese: UtensilsCrossed,
  "Japanese & sushi": Fish, Italian: UtensilsCrossed, Greek: UtensilsCrossed, Mexican: UtensilsCrossed, Seafood: Fish,
  "Vegetarian & vegan": Leaf, "Healthy food & salads": Salad, "Breakfast & brunch": EggFried, "Sandwiches & wraps": Sandwich,
  "Bakeries & pastries": Croissant, "Desserts & ice cream": IceCreamBowl, "Cafes & drinks": Coffee,
  "Fruit & vegetables": Apple, "Meat & poultry": Beef, "Fish & seafood": Fish, "Dairy & eggs": Milk,
  "Bread & bakery": Croissant, "Rice, pasta & grains": Wheat, "Pulses & beans": Bean, "Canned & jarred food": Archive,
  "Frozen food": Snowflake, "Ready meals": Soup, "Oils & cooking essentials": CookingPot, "Herbs, spices & seasonings": Leaf,
  "Sauces & condiments": CookingPot, "Breakfast cereals & spreads": Wheat, "Snacks & crisps": Cookie,
  "Sweets & chocolate": Candy, "Nuts & dried fruit": Nut, "Water, juices & soft drinks": CupSoda, "Tea & coffee": Coffee,
  "Baby food & essentials": Baby, "Cleaning & laundry": Brush, "Paper & household essentials": Layers,
};

type ProductBrowserProps = {
  initialQuery: string;
  initialCategory: string;
  categories: readonly ProductCategory[];
  products: readonly Product[];
  followedShopIds: readonly string[];
};

export function ProductBrowser({
  initialQuery,
  initialCategory,
  categories,
  products,
  followedShopIds,
}: ProductBrowserProps) {
  const [query, setQuery] = useState(initialQuery);
  const [activeCategory, setActiveCategory] = useState(initialCategory);
  const [currentTime, setCurrentTime] = useState(0);
  const [twoColumnMobileView, setTwoColumnMobileView] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [mobileSheetGroup, setMobileSheetGroup] = useState<string | null>(null);
  const mobileSheetRef = useRef<HTMLDialogElement>(null);
  const mobileSheetTriggerRef = useRef<HTMLButtonElement | null>(null);
  const isMobileSheetOpen = isMobileViewport && mobileSheetGroup !== null;
  const [categoryScroll, setCategoryScroll] = useState({ overflowing: false, atEnd: false });

  useEffect(() => {
    const dialog = mobileSheetRef.current;
    if (!isMobileSheetOpen || !dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      mobileSheetTriggerRef.current?.focus({ preventScroll: true });
    };
  }, [isMobileSheetOpen]);

  useEffect(() => {
    const tabs = document.getElementById("catalog-category-tabs");
    if (!tabs) return;
    const updateScroll = () => {
      const remaining = tabs.scrollWidth - tabs.clientWidth;
      setCategoryScroll({ overflowing: remaining > 1, atEnd: Math.abs(tabs.scrollLeft) >= remaining - 1 });
    };
    updateScroll();
    const observer = new ResizeObserver(updateScroll);
    observer.observe(tabs);
    tabs.addEventListener("scroll", updateScroll, { passive: true });
    return () => {
      observer.disconnect();
      tabs.removeEventListener("scroll", updateScroll);
    };
  }, [categories]);

  const scrollCategories = () => {
    const tabs = document.getElementById("catalog-category-tabs");
    if (!tabs) return;
    setOpenCategory(null);
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
    if (categoryScroll.atEnd) tabs.scrollTo({ left: 0, behavior });
    else tabs.scrollBy({ left: tabs.clientWidth * 0.75 * (getComputedStyle(tabs).direction === "rtl" ? -1 : 1), behavior });
  };

  useEffect(() => {
    if (!openCategory) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenCategory(null);
        document.getElementById(`category-trigger-${openCategory}`)?.focus();
      }
    };
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !document.getElementById("catalog-category-navigation")?.contains(event.target)) {
        setOpenCategory(null);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [openCategory]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 760px)");
    const updateViewport = () => {
      setIsMobileViewport(mediaQuery.matches);
      setOpenCategory(null);
      setMobileSheetGroup(null);
    };
    updateViewport();
    mediaQuery.addEventListener("change", updateViewport);
    return () => mediaQuery.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    const updateCurrentTime = () => setCurrentTime(Date.now());
    updateCurrentTime();
    const interval = window.setInterval(updateCurrentTime, 60_000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let idleTimer: number | null = null;

    const openDescriptionAfterScroll = () => {
      if (idleTimer !== null) window.clearTimeout(idleTimer);

      idleTimer = window.setTimeout(() => {
        idleTimer = null;
        if (document.querySelector(".description-panel")) return;

        const visibleCards = Array.from(
          document.querySelectorAll<HTMLElement>("[data-product-card]"),
        )
          .map((card) => {
            const bounds = card.getBoundingClientRect();
            const visibleWidth = Math.max(
              0,
              Math.min(bounds.right, window.innerWidth) - Math.max(bounds.left, 0),
            );
            const visibleHeight = Math.max(
              0,
              Math.min(bounds.bottom, window.innerHeight) - Math.max(bounds.top, 0),
            );

            return {
              card,
              visibleRatio:
                (visibleWidth * visibleHeight) / (bounds.width * bounds.height),
            };
          })
          .filter(({ visibleRatio }) => visibleRatio >= 0.4)
          .sort((first, second) => second.visibleRatio - first.visibleRatio);

        const descriptionButton = visibleCards[0]?.card.querySelector<HTMLButtonElement>(
          ".product-description-preview",
        );

        if (descriptionButton?.getAttribute("aria-expanded") === "false") {
          descriptionButton.click();
        }
      }, 5_000);
    };

    window.addEventListener("scroll", openDescriptionAfterScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", openDescriptionAfterScroll);
      if (idleTimer !== null) window.clearTimeout(idleTimer);
    };
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const categoryPath = getCategoryPath(categories, activeCategory);
  const selectedBranch = getCategoryBranchIds(categories, activeCategory);
  const rootCategories = categories.filter((category) => !category.parentId);
  const mobileRoot = categoryPath[0];
  const mobileGroups = categories.filter((category) => category.parentId === mobileRoot?.id);
  const sheetGroup = categories.find((category) => category.id === mobileSheetGroup);
  const sheetItems = categories.filter((category) => category.parentId === mobileSheetGroup);
  const sheetParent = categories.find((category) => category.id === sheetGroup?.parentId && category.id !== mobileRoot?.id);
  const menuRoot = categories.find((category) => category.id === openCategory);
  const menuGroups = categories.filter((category) => category.parentId === openCategory);
  const hasMenuSubgroups = menuGroups.some((group) => categories.some((category) => category.parentId === group.id));
  const menuGroup = categories.find((category) => category.id === openGroup) ?? menuRoot;
  const menuItems = categories.filter((category) => category.parentId === menuGroup?.id);
  const selectCategory = (categoryId: string) => {
    setActiveCategory(categoryId);
    setOpenCategory(null);
    setMobileSheetGroup(null);
  };
  const openCategoryMenu = (category: ProductCategory) => {
    const children = categories.filter((child) => child.parentId === category.id);
    if (!children.length) return;
    setOpenCategory(category.id);
    setOpenGroup(children.find((child) => categories.some((descendant) => descendant.parentId === child.id))?.id ?? category.id);
  };
  // Time windows are evaluated on the client only, after mount, to keep hydration stable.
  const isActiveUntil = (until?: string | null) => currentTime > 0 && Boolean(until) && Date.parse(until!) > currentTime;
  const filteredProducts = products.filter((product) => {
    const matchesCategory =
      activeCategory === "all" ||
      (activeCategory === "new" ? isActiveUntil(product.newUntil) : selectedBranch.has(product.category));
    const matchesQuery = !normalizedQuery || `${product.name} ${product.categoryName} ${product.description} ${product.maker}`.toLowerCase().includes(normalizedQuery);
    return matchesCategory && matchesQuery;
  }).sort((first, second) => Number(isActiveUntil(second.featuredUntil)) - Number(isActiveUntil(first.featuredUntil)));
  const followedShops = new Set(followedShopIds);
  const clearFilters = () => { setQuery(""); setActiveCategory("all"); setOpenCategory(null); };

  return (
    <main className="product-browser page-shell" id="discover">
      <div className="browse-tools">
        <div className="category-navigation" id="catalog-category-navigation" onMouseLeave={() => { if (!isMobileViewport) setOpenCategory(null); }}>
        <div className="category-tabs-row">
        <div className="filter-list" id="catalog-category-tabs" role="group" aria-label="Filter by category">
          <button className={`filter-button${activeCategory === "all" ? " is-active" : ""}`} type="button" aria-pressed={activeCategory === "all"} onClick={() => selectCategory("all")}><LayoutGrid size={15} aria-hidden="true" />All</button>
          <button className={`filter-button filter-button-new${activeCategory === "new" ? " is-active" : ""}`} type="button" aria-pressed={activeCategory === "new"} onClick={() => selectCategory("new")}><Sparkles size={15} aria-hidden="true" />New</button>
          {rootCategories.map((category) => {
            const hasChildren = categories.some((child) => child.parentId === category.id);
            const selected = categoryPath.some((ancestor) => ancestor.id === category.id);
            return <button id={`category-trigger-${category.id}`} className={`filter-button${selected || openCategory === category.id ? " is-active" : ""}`} type="button" aria-pressed={selected} aria-expanded={hasChildren ? (isMobileViewport ? selected : openCategory === category.id) : undefined} aria-controls={hasChildren ? (isMobileViewport ? "mobile-category-tabs" : "category-menu") : undefined} key={category.id} onMouseEnter={() => { if (!isMobileViewport) { setOpenCategory(null); openCategoryMenu(category); } }} onClick={() => { if (isMobileViewport || !hasChildren) selectCategory(category.id); else openCategoryMenu(category); }}>{category.name}</button>;
          })}
        </div>
        {categoryScroll.overflowing && <button className="category-scroll-button" type="button" aria-label={categoryScroll.atEnd ? "Back to first categories" : "More categories"} title={categoryScroll.atEnd ? "Back to first categories" : "More categories"} aria-controls="catalog-category-tabs" onClick={scrollCategories}>{categoryScroll.atEnd ? <ChevronLeft size={20} aria-hidden="true" /> : <ChevronRight size={20} aria-hidden="true" />}</button>}
        </div>
        {isMobileViewport && mobileRoot && mobileGroups.length > 0 && <div className="mobile-category-tabs" id="mobile-category-tabs" role="group" aria-label={`${mobileRoot.name} categories`} key={mobileRoot.id}>
          <button className={`filter-button${activeCategory === mobileRoot.id ? " is-active" : ""}`} type="button" aria-pressed={activeCategory === mobileRoot.id} onClick={() => selectCategory(mobileRoot.id)}><LayoutGrid size={18} aria-hidden="true" />All {mobileRoot.name}</button>
          {mobileGroups.map((group) => {
            const Icon = categoryIcons[group.name] ?? LayoutGrid;
            const hasChildren = categories.some((category) => category.parentId === group.id);
            const selected = categoryPath.some((category) => category.id === group.id);
            return <button className={`filter-button${selected || mobileSheetGroup === group.id ? " is-active" : ""}`} type="button" key={group.id} aria-pressed={selected} aria-haspopup={hasChildren ? "dialog" : undefined} aria-controls={hasChildren ? "mobile-category-sheet" : undefined} aria-expanded={hasChildren ? mobileSheetGroup === group.id : undefined} onClick={(event) => {
              if (!hasChildren) selectCategory(group.id);
              else {
                mobileSheetTriggerRef.current = event.currentTarget;
                setMobileSheetGroup(group.id);
              }
            }}><Icon size={18} aria-hidden="true" />{group.name}</button>;
          })}
        </div>}
        {isMobileViewport && <dialog className="mobile-category-sheet" id="mobile-category-sheet" ref={mobileSheetRef} aria-labelledby="mobile-category-sheet-title" onCancel={(event) => { event.preventDefault(); setMobileSheetGroup(null); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setMobileSheetGroup(null); } }} onClick={(event) => { if (event.target === event.currentTarget) setMobileSheetGroup(null); }}>
          {sheetGroup && <div className="mobile-category-sheet-content">
            <div className="category-menu-heading">
              {sheetParent && <button type="button" aria-label={`Back to ${sheetParent.name}`} onClick={() => setMobileSheetGroup(sheetParent.id)}><ChevronLeft size={20} aria-hidden="true" /></button>}
              <strong id="mobile-category-sheet-title">{sheetGroup.name}</strong>
              <button type="button" aria-label="Close category menu" onClick={() => setMobileSheetGroup(null)}><X size={20} aria-hidden="true" /></button>
            </div>
            <div className="category-menu-items">
              <button type="button" aria-current={activeCategory === sheetGroup.id ? "true" : undefined} onClick={() => selectCategory(sheetGroup.id)}>All {sheetGroup.name}</button>
              {sheetItems.map((category) => {
                const hasChildren = categories.some((child) => child.parentId === category.id);
                return <button type="button" key={category.id} aria-current={activeCategory === category.id ? "true" : undefined} onClick={() => { if (hasChildren) setMobileSheetGroup(category.id); else selectCategory(category.id); }}><span>{category.name}</span>{hasChildren && <ChevronRight size={18} aria-hidden="true" />}</button>;
              })}
            </div>
          </div>}
        </dialog>}
        {!isMobileViewport && menuRoot && (
          <>
            <button className="category-menu-backdrop" type="button" tabIndex={-1} aria-label="Close categories" onClick={() => setOpenCategory(null)} />
            <section className={`category-menu${hasMenuSubgroups ? "" : " category-menu-flat"}`} id="category-menu" aria-label={`${menuRoot.name} categories`}>
              <div className="category-menu-heading"><strong>{menuRoot.name}</strong><button type="button" aria-label="Close category menu" onClick={() => setOpenCategory(null)}><X size={18} aria-hidden="true" /></button></div>
              <div className="category-menu-groups">
                <button className="category-menu-option" type="button" onClick={() => selectCategory(menuRoot.id)}><LayoutGrid size={22} aria-hidden="true" /><span>All {menuRoot.name}</span></button>
                {menuGroups.map((group) => {
                  const Icon = categoryIcons[group.name] ?? LayoutGrid;
                  const hasChildren = categories.some((child) => child.parentId === group.id);
                  return <button className={`category-menu-option${menuGroup?.id === group.id ? " is-current" : ""}`} type="button" key={group.id} aria-expanded={hasChildren ? menuGroup?.id === group.id : undefined} aria-controls={hasChildren ? "category-menu-items" : undefined} onMouseEnter={() => { if (!isMobileViewport) setOpenGroup(group.id); }} onClick={() => { if (hasChildren) setOpenGroup(group.id); else selectCategory(group.id); }}><Icon size={22} aria-hidden="true" /><span>{group.name}</span>{hasChildren && <ChevronRight size={17} aria-hidden="true" />}</button>;
                })}
              </div>
              {hasMenuSubgroups && <div className="category-menu-items" id="category-menu-items">
                {menuGroup && <button type="button" onClick={() => selectCategory(menuGroup.id)}>All {menuGroup.name}</button>}
                {menuItems.map((category) => <button type="button" key={category.id} onClick={() => { if (categories.some((child) => child.parentId === category.id)) setOpenGroup(category.id); else selectCategory(category.id); }}>{category.name}</button>)}
              </div>}
            </section>
          </>
        )}
        </div>
        <div className="browser-search-row">
          <label className="browser-search" id="product-search">
            <Search size={16} aria-hidden="true" />
            <span className="visually-hidden">Search by product or category</span>
            <input id="product-search-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search for products, shops…" aria-controls="product-grid" />
            {query && <button className="clear-search" type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={15} aria-hidden="true" /></button>}
          </label>
          <button
            className="product-view-toggle"
            type="button"
            aria-label={twoColumnMobileView ? "Show one column" : "Show two columns"}
            aria-controls="product-grid"
            aria-pressed={twoColumnMobileView}
            title={twoColumnMobileView ? "Show one column" : "Show two columns"}
            onClick={() => setTwoColumnMobileView((current) => !current)}
          >
            {twoColumnMobileView ? <Rows2 size={19} aria-hidden="true" /> : <Columns2 size={19} aria-hidden="true" />}
          </button>
        </div>
      </div>
      {categoryPath.length > 0 && <nav className="category-breadcrumb" aria-label="Selected category"><button type="button" onClick={() => selectCategory("all")}>All</button>{categoryPath.map((category, index) => <span key={category.id}><ChevronRight size={13} aria-hidden="true" /><button type="button" aria-current={index === categoryPath.length - 1 ? "page" : undefined} onClick={() => selectCategory(category.id)}>{category.name}</button></span>)}</nav>}
      <p className="visually-hidden" role="status" aria-live="polite">{filteredProducts.length} {filteredProducts.length === 1 ? "find" : "finds"}</p>
      {filteredProducts.length ? (
        <div className="product-grid" id="product-grid" data-mobile-columns={twoColumnMobileView ? "two" : "one"}>
          {filteredProducts.map((product, index) => (
            <ProductCard
              product={product}
              priority={index < 2}
              isFeatured={isActiveUntil(product.featuredUntil)}
              isShopFollowed={product.sellerProfileId ? followedShops.has(product.sellerProfileId) : false}
              key={product.slug}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <p className="eyebrow">{products.length ? "Nothing here just yet" : "Product catalogue"}</p>
          <h3>{products.length ? "No finds match that search." : "No products are published yet."}</h3>
          <p>{products.length ? "Try another word or clear the category filter." : "Approved products will appear here when sellers publish their listings."}</p>
          {products.length > 0 && <button className="button button-outline" type="button" onClick={clearFilters}>Clear filters</button>}
        </div>
      )}
    </main>
  );
}