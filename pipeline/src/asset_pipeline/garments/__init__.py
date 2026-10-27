"""Our own garments: drafted from the outfit-base body, draped in Blender, packed as units.

The output is an archive unit (`raw/outfits/<gender>/WI_AS_<Name>/`) in the same shape as
the ones `ue outfits` writes, so `mh-convert --outfits` refits it like an Epic garment.
"""


class GarmentError(RuntimeError):
    """Raised when a garment cannot be drafted, simulated or packed."""
