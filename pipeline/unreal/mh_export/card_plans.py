"""Where the cards of the Fab grooms that ship without usable ones come from.

Pure (no `unreal` import) so the plans and the text the Dataflow node is given are tested
without the editor; `groom_cards.py` acts on them. Two sources:

- `PLANS`: Unreal's Hair Card Generator makes cards and an atlas from the strands.
- `HANDMADE`: an artist's cards shipped as FBX next to the Fab package (in
  `<archive>/fab_extras/`), imported and set as the groom's card LODs with their atlas.

Every plan generates LOD0 and two reductions of it. A reduction keeps LOD0's clumps and
texture atlas and only lowers the triangle and flyaway counts, so every LOD maps the same
atlas, as Epic's cards do (the converter reads one atlas for LOD0 and its light LOD, the
first of LOD2/LOD3/LOD1/LOD4). The generator derives a reduction from the LOD before it
(`<base>_LOD<n-1>`), so the chain has no gaps.
"""

from __future__ import annotations

from dataclasses import dataclass

CARDS_FOLDER = "HairCards"  # under the Fab package folder, so the grooms export finds them
# Epic's Hair_L_HighPonytail overrides its strand width to 0.0125 cm; some Fab grooms carry
# no width at all (1e-10 cm), which renders an empty coverage atlas.
DEFAULT_WIDTH_CM = 0.0125
ATLAS_SIZES = {1024: "AtlasSize1024", 2048: "AtlasSize2048", 4096: "AtlasSize4096"}


@dataclass(frozen=True)
class CardLod:
    """One generated LOD. The generator makes three cards per clump (multi-card clumps)."""

    lod: int
    triangles: int
    flyaways: int
    reduce: bool = False  # derive from the previous LOD (same clumps and atlas)


@dataclass(frozen=True)
class CardPlan:
    style: str
    clumps: int
    textures: int  # distinct strand textures packed into the atlas
    lods: tuple[CardLod, ...]
    width_cm: float | None = DEFAULT_WIDTH_CM  # None keeps the groom's own strand widths
    # Strand width in the textures relative to the groom's. 1.0 left Ponytail's atlas with
    # sub-pixel strands (coverage ~0.3 where a strand lies, Epic's ~0.8) and the scalp showed
    # through; 4.0 drew noodles.
    width_scale: float = 2.0
    seed: int = 7
    atlas: int = 4096

    def base_name(self) -> str:
        """Asset base name; the generator appends `_LOD<n>` (and `_PG<g>` for groups)."""
        return f"{self.style}_CardsMesh"

    def lod_names(self) -> list[str]:
        return [f"{self.base_name()}_LOD{lod.lod}" for lod in self.lods]

    def validate(self) -> None:
        indices = [lod.lod for lod in self.lods]
        if indices != list(range(len(indices))):
            raise ValueError(f"{self.style}: LODs must run 0..n without gaps, got {indices}")
        if self.lods[0].reduce:
            raise ValueError(f"{self.style}: LOD0 cannot be reduced from a previous LOD")
        if self.atlas not in ATLAS_SIZES:
            raise ValueError(f"{self.style}: atlas {self.atlas} not in {sorted(ATLAS_SIZES)}")


def _bool(value: bool) -> str:
    return "True" if value else "False"


def generation_settings_text(plan: CardPlan, lod_index: int | None = None) -> str:
    """`FBuildCardsSettingsNode.GenerationSettings` (TArray<FGroomGenerationSettings>) in
    Unreal's property text format, for `DataflowEditorBlueprintLibrary.SetDataflowNodeProperty`.

    `lod_index` keeps one LOD. The job generates one LOD per graph evaluation: with several,
    the terminal node builds every LOD's mesh from the card data of the LOD the generator
    loaded last."""
    plan.validate()
    entries = []
    for lod in plan.lods:
        if lod_index is not None and lod.lod != lod_index:
            continue
        advanced_filter = (
            "(bUseMultiCardClumps=True,bUseAdaptiveSubdivision=True,"
            "MaxVerticalSegmentsPerCard=12,"
            f"StrandWidthScalingFactor={plan.width_scale:.6f},"
            "UseOptimizedCompressionFactor=True)"
        )
        filter_settings = (
            f'(FilterName="All",NumClumps={plan.clumps},NumFlyaways={lod.flyaways},'
            f"NumTriangles={lod.triangles},NumTextures={plan.textures},"
            f"AdvancedOptions={advanced_filter})"
        )
        advanced = (
            f"(bReduceCardsFromPreviousLOD={_bool(lod.reduce)},"
            "bGenerateGeometryForAllGroups=True,"
            f"RandomSeed={plan.seed},"
            "bUseReservedSpaceFromPreviousLOD=False,"
            f"AtlasSize={ATLAS_SIZES[plan.atlas]},"
            "ReserveTextureSpaceLOD=0,"
            "bUseGroomAssetStrandWidth=True)"
        )
        entries.append(
            f"(LODIndex={lod.lod},GroupIndex=0,FilterSettings=({filter_settings}),"
            f"AdvancedOptions={advanced})"
        )
    if not entries:
        raise ValueError(f"{plan.style}: no LOD {lod_index}")
    return f"({','.join(entries)})"


def _lods(triangles: int, flyaways: int) -> tuple[CardLod, ...]:
    """LOD0 and two reductions, about two thirds and two fifths of LOD0's triangles
    (Epic's Hair_L_HighPonytail: 47.9k, LOD2 17.2k). Reductions keep the flyaway count:
    fewer flyaways means fewer cards, and the generator then indexes the reduced LOD's
    cards with LOD0's atlas layout (IndexError in `generate_mesh`)."""
    return (
        CardLod(0, triangles, flyaways),
        CardLod(1, triangles * 2 // 3, flyaways, reduce=True),
        CardLod(2, triangles * 2 // 5, flyaways, reduce=True),
    )


PLANS: dict[str, CardPlan] = {
    plan.style: plan
    for plan in (
        CardPlan("Ponytail", clumps=300, textures=100, lods=_lods(30000, 40)),
        # 34k long strands spiking up from the crown and 37k shaved ones (2.8 cm) on the
        # sides; 400 clumps left skin between the spikes at the crown.
        CardPlan("NomadWaveUndercut", clumps=800, textures=150, lods=_lods(45000, 60)),
        CardPlan("SC_Hairstyle_Male_11", clumps=400, textures=120, lods=_lods(30000, 60)),
    )
}


@dataclass(frozen=True)
class HandmadeCards:
    """Card LODs (FBX, LOD0 first) and their atlas, relative to `<archive>/fab_extras/<extras>`.
    The atlas follows Epic's layout: attribute RGB = coverage, depth-like value, seed;
    tangent RGB = strand direction in card tangent space, A = strand coordinate."""

    style: str
    extras: str
    lods: tuple[str, ...]
    attribute: str
    tangent: str

    def mesh_name(self, lod: int) -> str:
        return f"{self.style}_CardsMesh_LOD{lod}"

    def texture_name(self, role: str) -> str:
        """`attribute` or `tangent` under the name Epic gives its card atlases."""
        return f"{self.style}_CardsAtlas_{role.capitalize()}"


HANDMADE: dict[str, HandmadeCards] = {
    cards.style: cards
    for cards in (
        # The zip of the Fab listing: 669 cards, LOD0 37.3k triangles, LOD2 11.5k, 4K atlas.
        # Cards generated from its 67k strands (350 clumps, 40k triangles) came out as thick
        # clumps with a lock over each ear on /dev/stage; these keep the soft hairline.
        HandmadeCards(
            "Hair_F_Ponytail_MessyWavy_01",
            extras="hair_f_ponytail_messy_wavy_01",
            lods=tuple(f"LODs/Female_Adult_001_HairCard_LOD{n}.fbx" for n in range(5)),
            attribute="fiber_Attribue.png",
            tangent="fiber_Tangent.tga",
        ),
    )
}


def intermediate_entries(names: list[str], base: str) -> list[str]:
    """Generator intermediates (metadata, settings, card OBJs, atlas TGAs) of one plan:
    every entry whose name starts with the plan's base name and `_LOD`."""
    prefix = f"{base}_LOD"
    return sorted(name for name in names if name.startswith(prefix))
