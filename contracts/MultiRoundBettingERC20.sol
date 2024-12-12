// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract MultiRoundBettingERC20 is Ownable, ReentrancyGuard {
    IERC20 public token;
    uint256 public ownerFee; // fee in basis points
    uint256 public currentRound;

    struct Round {
        bool bettingOpen;
        bool settled;
        bool winnerA;
        uint256 totalStakedA; // Net staked (after fee)
        uint256 totalStakedB; // Net staked (after fee)
        uint256 totalFees;    // Fees collected this round
    }

    mapping(uint256 => Round) public rounds;
    mapping(uint256 => mapping(address => uint256)) public stakes;
    mapping(uint256 => mapping(address => bool)) public betOnA;
    mapping(uint256 => mapping(address => bool)) public participated;

    // We store a payoutRatio per round. Since no fee at settlement, ratio = (winnersPool + losersPool)/winnersPool
    // If no winners: ratio=1e18 (just stake back)
    // If no losers: ratio=1e18 (just stake back)
    mapping(uint256 => uint256) public payoutRatio; 

    // Track claimed rounds
    mapping(uint256 => mapping(address => bool)) public claimed; 
    mapping(address => uint256) public lastClaimedRound; 
    // Owner fee claim tracking
    mapping(uint256 => bool) public feesClaimed;
    uint256 public lastClaimedFeeRound;

    constructor(IERC20 _token, uint256 _fee) Ownable(msg.sender) {
        token = _token;
        ownerFee = _fee;
        currentRound = 1;
        rounds[currentRound].bettingOpen = true;
    }

    function startNewRound() external onlyOwner {
        require(rounds[currentRound].settled, "Prev not settled");
        currentRound++;
        rounds[currentRound].bettingOpen = true;
    }

    function deposit(uint256 amount, bool onA) external nonReentrant {
        require(amount > 0, "Cannot deposit zero");
        Round storage r = rounds[currentRound];
        require(r.bettingOpen, "Closed");
        uint256 prev = stakes[currentRound][msg.sender];
        if (prev > 0) require(betOnA[currentRound][msg.sender] == onA, "Can't switch teams mid-round");

        token.transferFrom(msg.sender, address(this), amount);

        // Calculate immediate fee
        uint256 fee = (amount * ownerFee) / 10000;
        uint256 netStake = amount - fee;

        // Update round info
        stakes[currentRound][msg.sender] += netStake;
        if (!participated[currentRound][msg.sender]) {
            participated[currentRound][msg.sender] = true;
        }
        betOnA[currentRound][msg.sender] = onA;
        if (onA) r.totalStakedA += netStake; else r.totalStakedB += netStake;
        r.totalFees += fee;
    }

    function closeBetting() external onlyOwner {
        rounds[currentRound].bettingOpen = false;
    }

    // Settle bet without iterating over participants.
    // ratio = (winnersPool + losersPool)/winnersPool if there are both winners and losers
    // If no winners => ratio=1e18 (everyone gets their stake back)
    // If no losers => ratio=1e18 (winners get just their stake)
    function settleBet(bool _winnerA) external onlyOwner {
        Round storage r = rounds[currentRound];
        require(!r.settled, "Already settled");
        r.settled = true;
        r.winnerA = _winnerA;

        uint256 winnersPool = _winnerA ? r.totalStakedA : r.totalStakedB;
        uint256 losersPool = _winnerA ? r.totalStakedB : r.totalStakedA;

        if (winnersPool == 0 || losersPool == 0) {
            // No winners or no losers: ratio=1e18 for simplicity
            payoutRatio[currentRound] = 1e18;
        } else {
            // ratio = (winnersPool + losersPool)*1e18 / winnersPool
            payoutRatio[currentRound] = ((winnersPool + losersPool) * 1e18) / winnersPool;
        }
    }

    // Users claim all settled rounds from lastClaimedRound+1 to currentRound
    function claimAllWinnings() external nonReentrant {
        uint256 start = lastClaimedRound[msg.sender] + 1;
        uint256 totalTransfer;
        for (uint256 i = start; i <= currentRound; i++) {
            Round memory r = rounds[i];
            if (!r.settled) break; // stop if not settled
            if (claimed[i][msg.sender]) continue;
            uint256 st = stakes[i][msg.sender];
            if (st == 0) continue;
            bool won = (r.winnerA && betOnA[i][msg.sender]) || (!r.winnerA && !betOnA[i][msg.sender]);
            uint256 ratio = payoutRatio[i];

            uint256 payout;
            if (ratio == 1e18 && won) {
                // just stake back
                payout = st;
            } else if (ratio == 1e18 && !won) {
                // losers get nothing if ratio=1e18 and no winners? Actually if no winners, ratio=1e18 means everyone gets stake
                // but if no winners, there are no "won" scenario
                // If no winners: no one "won", everyone gets their stake. That means won is false, but we must still pay stake back
                // handle no winners scenario:
                if (r.totalStakedA == 0 || r.totalStakedB == 0) {
                    // no winners scenario = everyone gets stake (since ratio=1e18 and no winners)
                    payout = st;
                } else {
                    payout = 0;
                }
            } else if (!won) {
                payout = 0;
            } else {
                // won and ratio != 1e18
                payout = (st * ratio) / 1e18;
            }

            if (payout > 0) {
                claimed[i][msg.sender] = true;
                totalTransfer += payout;
            }
        }
        require(totalTransfer > 0, "Nothing");
        token.transfer(msg.sender, totalTransfer);
        lastClaimedRound[msg.sender] = currentRound;
    }

    // Owner claims all fees from settled rounds since lastClaimedFeeRound+1
    // Fees were collected at deposit time and stored in rounds[round].totalFees
    function withdrawAllFees() external onlyOwner nonReentrant {
        uint256 start = lastClaimedFeeRound + 1;
        uint256 totalFees;
        for (uint256 i = start; i <= currentRound; i++) {
            Round memory r = rounds[i];
            if (!r.settled) break;
            if (feesClaimed[i]) continue;
            if (r.totalFees > 0) {
                feesClaimed[i] = true;
                totalFees += r.totalFees;
            }
        }
        require(totalFees > 0, "No fees");
        lastClaimedFeeRound = currentRound;
        token.transfer(msg.sender, totalFees);
    }
}
