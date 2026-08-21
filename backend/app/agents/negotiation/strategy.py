from typing import Tuple

class NegotiationStrategy:
    """Calculates tactical concessions and vendor counterpart responses."""

    @staticmethod
    def calculate_counter_offer(
        initial_price: float,
        target_savings_percent: float = 8.0,
        round_num: int = 1
    ) -> float:
        """Proposes aggressive yet credible initial counter, stepping toward target."""
        if round_num == 1:
            # 1st counter: Ask for ~12% savings to anchor
            return round(initial_price * (1.0 - 0.12), -2)
        elif round_num == 2:
            # 2nd counter: Settle closer to target (~9% savings)
            return round(initial_price * (1.0 - 0.09), -2)
        else:
            # 3rd counter: Final offer at exact target (~8% savings)
            return round(initial_price * (1.0 - (target_savings_percent / 100.0)), -2)

    @staticmethod
    def simulate_vendor_response(
        initial_price: float,
        producer_counter: float,
        round_num: int,
        target_savings_percent: float = 8.0
    ) -> Tuple[float, str, bool]:
        """
        Simulates realistic vendor pricing response curve.
        Returns (vendor_price, message, is_accepted_by_vendor)
        """
        floor_price = initial_price * (1.0 - 0.10)  # Vendor won't go below 10% off

        if producer_counter >= initial_price * (1.0 - (target_savings_percent / 100.0)):
            # Vendor happily accepts if counter is within target bounds
            return producer_counter, f"Vendor accepted proposal of ₹{producer_counter:,.0f} for full 3-day production package.", True

        if round_num == 1:
            # Vendor meets halfway
            vendor_counter = round(initial_price - ((initial_price - producer_counter) * 0.45), -2)
            return vendor_counter, f"Vendor offered concession to ₹{vendor_counter:,.0f} (-{((initial_price - vendor_counter)/initial_price)*100:.1f}%) including 3-day bundle rate.", False
        elif round_num == 2:
            vendor_counter = round(initial_price - ((initial_price - producer_counter) * 0.75), -2)
            return vendor_counter, f"Vendor offered revised rate of ₹{vendor_counter:,.0f} (-{((initial_price - vendor_counter)/initial_price)*100:.1f}%) with on-site technician included.", False
        else:
            # Final round: Vendor accepts target price
            final_price = max(producer_counter, floor_price)
            return final_price, f"Final round agreement reached at ₹{final_price:,.0f} with full insurance and support bundle.", True
