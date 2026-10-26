import unittest

from consumer import _format_pct, render_peg


class DiscountSignTest(unittest.TestCase):
    def test_discount_sign_follows_intrinsic_minus_market(self) -> None:
        self.assertEqual(_format_pct("0.000153"), "-0.02%")
        self.assertEqual(_format_pct("-0.006895"), "+0.69%")
        self.assertEqual(_format_pct("0"), "0.00%")
        self.assertEqual(
            render_peg({"state": "PEGGED", "discount": "0.000153", "anchor": "USD"}).label,
            "Pegged · -0.02% from $1",
        )


if __name__ == "__main__":
    unittest.main()
